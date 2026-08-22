/**
 * 支付宝登录鉴权：未登录跳转 oauth-center，回调后用 auth_code/state 换 token 并拉取用户信息，
 * 结果存 localStorage；刷新时校验 token，失效则重新跳转登录。
 * 微信内访问时不要求登录，直接进入主应用。
 */
(function () {
  'use strict';

  const STORAGE_TOKEN_KEY = 'crypto_ai_auth_token';
  const STORAGE_USER_KEY = 'crypto_ai_auth_user';
  const API_PREFIX = './crypto-ai-api';

  /**
   * 是否在微信内置浏览器内
   * @returns {boolean}
   */
  function isWeChat() {
    var ua = typeof navigator !== 'undefined' && navigator.userAgent ? navigator.userAgent : '';
    return true // /MicroMessenger/i.test(ua);
  }

  /**
   * 从当前 URL 解析 auth_code 和 state
   * @returns {{ auth_code: string | null, state: string | null }}
   */
  function getAuthParams() {
    const params = new URLSearchParams(window.location.search);
    const auth_code = params.get('auth_code');
    const state = params.get('state');
    return { auth_code: auth_code || null, state: state || null };
  }

  /**
   * 清除 URL 上的 auth_code 和 state，避免刷新重复用码
   */
  function clearAuthParamsFromUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete('auth_code');
    url.searchParams.delete('state');
    const clean = url.pathname + url.search + url.hash;
    window.history.replaceState(null, '', clean);
  }

  /**
   * 获取登录页基础 URL（从后端 /crypto-ai-api/auth/config）
   * @returns {Promise<string | null>}
   */
  function getLoginPageBaseUrl() {
    return fetch(API_PREFIX + '/auth/config')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.success && data.loginPageBaseUrl) return data.loginPageBaseUrl;
        return null;
      })
      .catch(function () { return null; });
  }

  /**
   * 构建登录跳转 URL，当前页为 redirect_url
   * @param {string} loginPageBaseUrl
   * @returns {string}
   */
  function buildLoginUrl(loginPageBaseUrl) {
    const currentPageUrl = window.location.origin + window.location.pathname;
    const base = (loginPageBaseUrl || '').replace(/\/$/, '');
    return base + '/?redirect_url=' + encodeURIComponent(currentPageUrl);
  }

  /**
   * 用 auth_code + state 换 token
   * @param {string} auth_code
   * @param {string} state
   * @returns {Promise<{ success: boolean, token?: string, message?: string }>}
   */
  function exchangeCode(auth_code, state) {
    return fetch(API_PREFIX + '/auth/exchange-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auth_code: auth_code, state: state })
    }).then(function (res) { return res.json(); });
  }

  /**
   * 用 token 校验并取用户信息
   * @param {string} token
   * @returns {Promise<{ success: boolean, data?: { id, nickname, avatar, phone }, message?: string }>}
   */
  function verifyToken(token) {
    return fetch(API_PREFIX + '/auth/verify-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token })
    }).then(function (res) { return res.json(); });
  }

  function getStoredToken() {
    try {
      return localStorage.getItem(STORAGE_TOKEN_KEY) || null;
    } catch (_) {
      return null;
    }
  }

  function setStoredAuth(token, user) {
    try {
      localStorage.setItem(STORAGE_TOKEN_KEY, token);
      localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(user || {}));
    } catch (_) {}
  }

  function clearStoredAuth() {
    try {
      localStorage.removeItem(STORAGE_TOKEN_KEY);
      localStorage.removeItem(STORAGE_USER_KEY);
    } catch (_) {}
  }

  /**
   * 显示“登录中…”或错误提示
   * @param {string} message
   * @param {boolean} isError
   */
  function showAuthStatus(message, isError) {
    var el = document.getElementById('auth-status');
    if (!el) {
      el = document.createElement('div');
      el.id = 'auth-status';
      el.setAttribute('aria-live', 'polite');
      el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);padding:16px 24px;background:var(--bg-tertiary,#252d3d);color:var(--text-primary,#e8eaed);border-radius:8px;border:1px solid var(--border,#2f3336);z-index:10000;';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.style.color = isError ? 'var(--error,#f4212e)' : 'var(--text-primary,#e8eaed)';
  }

  /**
   * 移除 auth-status 节点
   */
  function hideAuthStatus() {
    var el = document.getElementById('auth-status');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  /**
   * 鉴权通过后初始化主应用：触发自定义事件，由 app.js 监听并 new CryptoAIApp()
   */
  function initApp() {
    hideAuthStatus();
    document.body.classList.remove('auth-pending');
    window.dispatchEvent(new CustomEvent('crypto-ai-auth-ready'));
  }

  /**
   * 跳转到登录页；若无法获取 loginPageBaseUrl 则显示“登录服务未配置”
   */
  function redirectToLogin() {
    getLoginPageBaseUrl().then(function (baseUrl) {
      if (baseUrl) {
        window.location.href = buildLoginUrl(baseUrl);
      } else {
        showAuthStatus('登录服务未配置，请联系管理员', true);
      }
    });
  }

  /**
   * 主流程：根据 URL / 本地 token 决定换码、校验或跳转登录，通过后 initApp()
   * 微信内访问时跳过登录，直接进入主应用
   */
  function runAuth() {
    if (isWeChat()) {
      initApp();
      return;
    }

    var params = getAuthParams();
    var hasCode = params.auth_code && params.state;

    if (hasCode) {
      showAuthStatus('登录中…', false);
      exchangeCode(params.auth_code, params.state)
        .then(function (data) {
          if (!data.success || !data.token) {
            clearAuthParamsFromUrl();
            showAuthStatus(data.message || '登录失败，请重试', true);
            setTimeout(function () { redirectToLogin(); }, 1500);
            return;
          }
          return verifyToken(data.token).then(function (userRes) {
            if (!userRes.success || !userRes.data) {
              clearAuthParamsFromUrl();
              showAuthStatus(userRes.message || '获取用户信息失败', true);
              setTimeout(function () { redirectToLogin(); }, 1500);
              return;
            }
            setStoredAuth(data.token, userRes.data);
            clearAuthParamsFromUrl();
            initApp();
          });
        })
        .catch(function () {
          clearAuthParamsFromUrl();
          showAuthStatus('网络错误，请重试', true);
          setTimeout(function () { redirectToLogin(); }, 1500);
        });
      return;
    }

    var token = getStoredToken();
    if (!token) {
      redirectToLogin();
      return;
    }

    showAuthStatus('登录中…', false);
    verifyToken(token)
      .then(function (data) {
        if (data.success && data.data) {
          setStoredAuth(token, data.data);
          initApp();
        } else {
          clearStoredAuth();
          redirectToLogin();
        }
      })
      .catch(function () {
        clearStoredAuth();
        redirectToLogin();
      });
  }

  /**
   * 登出：清除本地并跳转登录页
   */
  function logout() {
    clearStoredAuth();
    getLoginPageBaseUrl().then(function (baseUrl) {
      if (baseUrl) {
        window.location.href = buildLoginUrl(baseUrl);
      } else {
        window.location.reload();
      }
    });
  }

  // 暴露给全局，供 header 退出按钮等使用
  window.CryptoAIAuth = {
    getToken: getStoredToken,
    getUser: function () {
      try {
        var raw = localStorage.getItem(STORAGE_USER_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (_) {
        return null;
      }
    },
    logout: logout,
    buildLoginUrl: buildLoginUrl,
    getLoginPageBaseUrl: getLoginPageBaseUrl,
    isWeChat: isWeChat
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runAuth);
  } else {
    runAuth();
  }
})();
