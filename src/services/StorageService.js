import fs from 'fs/promises';
import path from 'path';
import config from '../config/index.js';

class StorageService {
  constructor() {
    this.storageDir = path.join(process.cwd(), 'storage', 'chats');
    this.init();
  }

  async init() {
    try {
      await fs.mkdir(this.storageDir, { recursive: true });
      this.startCleanupTask();
    } catch (error) {
      console.error('Failed to initialize storage:', error);
    }
  }

  getDatePath(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return path.join(this.storageDir, `${year}-${month}-${day}`);
  }

  getChatPath(sessionId) {
    const date = new Date();
    const datePath = this.getDatePath(date);
    return path.join(datePath, `${sessionId}.json`);
  }

  async saveChat(sessionId, messages) {
    try {
      const chatPath = this.getChatPath(sessionId);
      const dir = path.dirname(chatPath);
      
      await fs.mkdir(dir, { recursive: true });
      
      const data = {
        sessionId,
        messages,
        updatedAt: new Date().toISOString()
      };
      
      await fs.writeFile(chatPath, JSON.stringify(data, null, 2));
      return true;
    } catch (error) {
      console.error('Failed to save chat:', error);
      return false;
    }
  }

  async loadChat(sessionId) {
    try {
      // 先尝试当天的路径
      let chatPath = this.getChatPath(sessionId);
      try {
        const content = await fs.readFile(chatPath, 'utf-8');
        const data = JSON.parse(content);
        return data.messages;
      } catch (error) {
        // 如果当天找不到，搜索所有日期目录
        const dates = await fs.readdir(this.storageDir);
        for (const date of dates) {
          const datePath = path.join(this.storageDir, date);
          chatPath = path.join(datePath, `${sessionId}.json`);
          try {
            const content = await fs.readFile(chatPath, 'utf-8');
            const data = JSON.parse(content);
            return data.messages;
          } catch (e) {
            continue;
          }
        }
        return null;
      }
    } catch (error) {
      return null;
    }
  }

  async deleteChat(sessionId) {
    try {
      // 先尝试当天的路径
      let chatPath = this.getChatPath(sessionId);
      try {
        await fs.unlink(chatPath);
        return true;
      } catch (error) {
        // 如果当天找不到，搜索所有日期目录
        const dates = await fs.readdir(this.storageDir);
        for (const date of dates) {
          const datePath = path.join(this.storageDir, date);
          chatPath = path.join(datePath, `${sessionId}.json`);
          try {
            await fs.unlink(chatPath);
            return true;
          } catch (e) {
            continue;
          }
        }
        return false;
      }
    } catch (error) {
      return false;
    }
  }

  async listChats() {
    try {
      const dates = await fs.readdir(this.storageDir);
      const chats = [];

      for (const date of dates) {
        const datePath = path.join(this.storageDir, date);
        const files = await fs.readdir(datePath);
        
        for (const file of files) {
          if (file.endsWith('.json')) {
            const filePath = path.join(datePath, file);
            const content = await fs.readFile(filePath, 'utf-8');
            const data = JSON.parse(content);
            
            chats.push({
              sessionId: data.sessionId,
              date,
              messageCount: data.messages.length,
              lastMessage: data.messages.find(msg => msg.role === 'user')?.content?.substring(0, 50) || '新对话',
              updatedAt: data.updatedAt
            });
          }
        }
      }

      return chats.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    } catch (error) {
      console.error('Failed to list chats:', error);
      return [];
    }
  }

  async cleanup() {
    try {
      const retentionDate = new Date();
      retentionDate.setDate(retentionDate.getDate() - config.storage.retentionDays);

      const dates = await fs.readdir(this.storageDir);
      
      for (const date of dates) {
        const dateObj = new Date(date);
        if (dateObj < retentionDate) {
          const datePath = path.join(this.storageDir, date);
          await fs.rm(datePath, { recursive: true, force: true });
          console.log(`Cleaned up old chats: ${date}`);
        }
      }
    } catch (error) {
      console.error('Cleanup failed:', error);
    }
  }

  startCleanupTask() {
    // 每天凌晨2点清理
    const scheduleCleanup = () => {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(2, 0, 0, 0);
      
      const timeout = tomorrow - now;
      
      setTimeout(() => {
        this.cleanup();
        scheduleCleanup();
      }, timeout);
    };

    scheduleCleanup();
  }
}

export default new StorageService();
