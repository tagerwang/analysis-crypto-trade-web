/**
 * Casdoor OIDC 登录鉴权：所有浏览器（含微信内）未登录一律跳 Casdoor 登录页（含注册），
 * 回调带 code/state，后端用 code 换 token 并拉用户信息，结果存 localStorage；
 * 刷新时向后端校验 token，失效则重新跳转登录。
 */
(function () {
  'use strict';

  const STORAGE_TOKEN_KEY = 'crypto_ai_auth_token';
  const STORAGE_USER_KEY = 'crypto_ai_auth_user';
  const STORAGE_STATE_KEY = 'crypto_ai_oauth_state';
  const API_PREFIX = './crypto-ai-api';

  /**
   * 是否在微信内置浏览器内（微信内不强制登录）
   * @returns {boolean}
   */
  function isWeChat() {
    var ua = typeof navigator !== 'undefined' && navigator.userAgent ? navigator.userAgent : '';
    return /MicroMessenger/i.test(ua);
  }

  /** 获取登录配置（authorize 端点 + clientId） */
  function getAuthConfig() {
    return fetch(API_PREFIX + '/auth/config')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.success && data.loginPageBaseUrl && data.clientId) {
          return { authorizeUrl: data.loginPageBaseUrl, clientId: data.clientId };
        }
        return null;
      })
      .catch(function () { return null; });
  }

  /**
   * 跳转 Casdoor 登录页；redirect_uri 为当前页，state 防 CSRF
   */
  function redirectToLogin() {
    getAuthConfig().then(function (cfg) {
      if (!cfg) {
        showAuthStatus('登录服务未配置，请联系管理员', true);
        return;
      }
      var state = Math.random().toString(36).slice(2) + Date.now().toString(36);
      try { sessionStorage.setItem(STORAGE_STATE_KEY, state); } catch (_) {}
      var redirectUri = window.location.origin + window.location.pathname;
      var url = cfg.authorizeUrl +
        '?client_id=' + encodeURIComponent(cfg.clientId) +
        '&redirect_uri=' + encodeURIComponent(redirectUri) +
        '&response_type=code' +
        '&scope=openid%20profile%20email' +
        '&state=' + encodeURIComponent(state);
      window.location.href = url;
    });
  }

  /**
   * 从当前 URL 解析 code 和 state
   * @returns {{ code: string | null, state: string | null }}
   */
  function getAuthParams() {
    const params = new URLSearchParams(window.location.search);
    return {
      code: params.get('code') || params.get('auth_code'),
      state: params.get('state')
    };
  }

  /**
   * 清除 URL 上的 code 和 state，避免刷新重复用码
   */
  function clearAuthParamsFromUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete('code');
    url.searchParams.delete('auth_code');
    url.searchParams.delete('state');
    const clean = url.pathname + url.search + url.hash;
    window.history.replaceState(null, '', clean);
  }

  /**
   * 用 code + redirect_uri 换 token 和用户信息
   */
  function exchangeCode(code, redirectUri) {
    return fetch(API_PREFIX + '/auth/exchange-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code, redirect_uri: redirectUri })
    }).then(function (res) { return res.json(); });
  }

  /**
   * 用 token 校验并取用户信息
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
   * 显示"登录中…"或错误提示
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
   * 主流程：URL 带 code 则换码；否则本地 token 校验；都没有则跳登录
   */
  function runAuth() {
    var params = getAuthParams();

    if (params.code) {
      // 校验 state 防 CSRF
      var savedState = null;
      try { savedState = sessionStorage.getItem(STORAGE_STATE_KEY); } catch (_) {}
      if (params.state && savedState && params.state !== savedState) {
        showAuthStatus('登录状态校验失败，请重试', true);
        clearAuthParamsFromUrl();
        setTimeout(function () { redirectToLogin(); }, 1500);
        return;
      }
      showAuthStatus('登录中…', false);
      var redirectUri = window.location.origin + window.location.pathname;
      exchangeCode(params.code, redirectUri)
        .then(function (data) {
          clearAuthParamsFromUrl();
          try { sessionStorage.removeItem(STORAGE_STATE_KEY); } catch (_) {}
          if (!data.success || !data.token) {
            showAuthStatus(data.message || '登录失败，请重试', true);
            setTimeout(function () { redirectToLogin(); }, 1500);
            return;
          }
          setStoredAuth(data.token, data.data);
          initApp();
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
    redirectToLogin();
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
    redirectToLogin: redirectToLogin,
    isWeChat: isWeChat
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runAuth);
  } else {
    runAuth();
  }
})();
