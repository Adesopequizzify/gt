import express from 'express';
import bodyParser from 'body-parser';
import axios from 'axios';
import { promises as fs } from 'fs';
import crypto from 'crypto';

const app = express();
app.use(bodyParser.json());

const BOT_TOKEN = '7653336178:AAE8KKXEKFILBP6j86OvsYWFPKq4DPnXlmA';
const CHANNEL_ID = '@swhit_tg';
const ADMIN_ID = '6761051997';
const ADMIN_USERNAME = '@Techque_tg';

// Store active conversations
const conversations = new Map();
const pendingAuthorizations = new Map();

// Conversation state handler
class Conversation {
  constructor(chatId) {
    this.chatId = chatId;
    this.currentStep = 0;
    this.data = {
      content: '',
      button: null,
      links: [],
      image: null
    };
    this.steps = [
      { prompt: 'Enter the post content:', handler: (text) => this.data.content = text },
      { 
        prompt: 'Send an image for the post (or type "skip" to skip):',
        handler: async (message) => {
          if (message.text && message.text.toLowerCase() === 'skip') {
            return true;
          }
          if (message.photo) {
            const fileId = message.photo[message.photo.length - 1].file_id;
            const fileInfo = await getFile(fileId);
            this.data.image = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;
            return true;
          }
          await sendMessage(this.chatId, 'Please send an image or type "skip".');
          return false;
        }
      },
      { 
        prompt: 'Enter button text (or "skip" to skip):', 
        handler: (text) => {
          if (text.toLowerCase() !== 'skip') {
            this.data.button = { text };
          }
          return true;
        }
      },
      {
        prompt: 'Enter button URL (or "skip" to skip):',
        handler: (text) => {
          if (this.data.button && text.toLowerCase() !== 'skip') {
            this.data.button.url = text;
          }
          return true;
        }
      },
      {
        prompt: 'Enter any additional links (format: text|url, or "done" to finish):',
        handler: async (text) => {
          if (text.toLowerCase() === 'done') {
            await this.finishConversation();
            return true;
          }
          const [linkText, url] = text.split('|');
          if (linkText && url) {
            this.data.links.push({ text: linkText, url });
            await sendMessage(this.chatId, 'Link added. Enter another link or type "done" to finish:');
          } else {
            await sendMessage(this.chatId, 'Invalid format. Please use text|url format or type "done" to finish.');
          }
          return false;
        }
      }
    ];
  }

  async handleResponse(message) {
    if (this.currentStep >= this.steps.length) return;

    const step = this.steps[this.currentStep];
    const result = await step.handler(message);
    
    if (result !== false) {
      this.currentStep++;
      if (this.currentStep < this.steps.length) {
        await sendMessage(this.chatId, this.steps[this.currentStep].prompt);
      }
    }
  }

  async start() {
    await sendMessage(this.chatId, this.steps[0].prompt);
  }

  async finishConversation() {
    await sendPreview(this.chatId, this.data);
    conversations.delete(this.chatId);
  }
}

async function validateBot() {
  try {
    const response = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
    console.log('Bot validation successful:', response.data.result.username);
    return true;
  } catch (error) {
    console.error('Bot validation failed:', error.response?.data || error.message);
    return false;
  }
}

async function handleMessage(message) {
  const { text, chat } = message;
  const chatId = chat.id;

  if (text === '/start') {
    await sendMessage(chatId, 'Welcome! Here are the available commands:\n\n' +
      '/start - Show this message\n' +
      '/createnewpost - Start creating a new post\n' +
      '/authorize - Request authorization to use the bot');
    return;
  }

  if (text === '/authorize') {
    await handleAuthorization(chatId);
    return;
  }

  if (!(await isAuthorized(chatId))) {
    await sendMessage(chatId, 'You are not authorized to use this bot. Please use /authorize to request access.');
    return;
  }

  if (text === '/createnewpost') {
    const conversation = new Conversation(chatId);
    conversations.set(chatId, conversation);
    await conversation.start();
    return;
  }

  const activeConversation = conversations.get(chatId);
  if (activeConversation) {
    await activeConversation.handleResponse(message);
  }
}

async function handleAuthorization(chatId) {
  if (chatId.toString() === ADMIN_ID) {
    await sendMessage(chatId, 'You are already authorized as the admin.');
    return;
  }
  const authCode = crypto.randomInt(100000, 999999).toString();
  pendingAuthorizations.set(chatId, authCode);
  await sendMessage(ADMIN_ID, `User ${chatId} is requesting authorization. Their code is: ${authCode}`);
  await sendMessage(chatId, 'Authorization request sent to the admin. Please wait for the admin to provide you with a 6-digit code, then send it here.');
}

async function isAuthorized(chatId) {
  try {
    let authorizedUsers = [];
    try {
      const data = await fs.readFile('authorized_users.json', 'utf8');
      authorizedUsers = JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, create it with the admin ID
        authorizedUsers = [ADMIN_ID];
        await fs.writeFile('authorized_users.json', JSON.stringify(authorizedUsers));
      } else {
        console.error('Error reading authorized_users.json:', error);
      }
    }
    return authorizedUsers.includes(chatId.toString());
  } catch (error) {
    console.error('Error checking authorization:', error);
    return chatId.toString() === ADMIN_ID; // Always allow admin
  }
}

async function addAuthorizedUser(chatId) {
  try {
    let authorizedUsers = [];
    try {
      const data = await fs.readFile('authorized_users.json', 'utf8');
      authorizedUsers = JSON.parse(data);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('Error reading authorized_users.json:', error);
      }
    }
    if (!authorizedUsers.includes(chatId.toString())) {
      authorizedUsers.push(chatId.toString());
      await fs.writeFile('authorized_users.json', JSON.stringify(authorizedUsers));
    }
  } catch (error) {
    console.error('Error adding authorized user:', error);
  }
}

async function sendPreview(chatId, postData) {
  const previewText = formatMessage(postData);
  await sendMessage(chatId, 'Here\'s a preview of your post:');
  if (postData.image) {
    await sendPhoto(chatId, postData.image, previewText);
  } else {
    await sendMessage(chatId, previewText, 'HTML', postData.button);
  }
  await sendMessage(chatId, 'Do you want to send this post?', 'HTML', {
    inline_keyboard: [
      [
        { text: 'Send', callback_data: 'send_post' },
        { text: 'Edit', callback_data: 'edit_post' },
        { text: 'Discard', callback_data: 'discard_post' }
      ]
    ]
  });
}

function formatMessage(postData) {
  let messageText = `${postData.content}\n\n`;

  postData.links.forEach(link => {
    messageText += `<a href="${link.url}">${link.text}</a>\n`;
  });

  return messageText;
}

async function sendFormattedMessage(postData) {
  const messageText = formatMessage(postData);

  const inlineKeyboard = postData.button ? 
    { inline_keyboard: [[{ text: postData.button.text, url: postData.button.url }]] } :
    undefined;

  try {
    if (postData.image) {
      await sendPhoto(CHANNEL_ID, postData.image, messageText, inlineKeyboard);
    } else {
      await sendMessage(CHANNEL_ID, messageText, 'HTML', inlineKeyboard);
    }
  } catch (error) {
    console.error('Error sending message:', error.response?.data || error.message);
  }
}

async function sendMessage(chatId, text, parseMode = 'HTML', replyMarkup = null) {
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: parseMode
  };

  if (replyMarkup) {
    payload.reply_markup = JSON.stringify(replyMarkup);
  }

  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, payload);
  } catch (error) {
    console.error('Error sending message:', error.response?.data || error.message);
  }
}

async function sendPhoto(chatId, photo, caption, replyMarkup = null) {
  const payload = {
    chat_id: chatId,
    photo: photo,
    caption: caption,
    parse_mode: 'HTML'
  };

  if (replyMarkup) {
    payload.reply_markup = JSON.stringify(replyMarkup);
  }

  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, payload);
  } catch (error) {
    console.error('Error sending photo:', error.response?.data || error.message);
  }
}

async function getFile(fileId) {
  try {
    const response = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getFile`, {
      params: { file_id: fileId }
    });
    return response.data.result;
  } catch (error) {
    console.error('Error getting file:', error.response?.data || error.message);
  }
}

// Webhook endpoint
app.post('/webhook', async (req, res) => {
  try {
    const update = req.body;
    if (update.message) {
      await handleMessage(update.message);
    } else if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
    }
    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error);
    res.sendStatus(500);
  }
});

async function handleCallbackQuery(callbackQuery) {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  switch (data) {
    case 'send_post':
      await sendFormattedMessage(conversations.get(chatId).data);
      await sendMessage(chatId, 'Post sent to the channel successfully!');
      conversations.delete(chatId);
      break;
    case 'edit_post':
      const conversation = new Conversation(chatId);
      conversations.set(chatId, conversation);
      await conversation.start();
      break;
    case 'discard_post':
      await sendMessage(chatId, 'Post discarded. You can start over with /createnewpost');
      conversations.delete(chatId);
      break;
  }

  await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
    callback_query_id: callbackQuery.id
  });
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

async function initializeAuthorizedUsers() {
  try {
    await fs.access('authorized_users.json');
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist, create it with the admin ID
      await fs.writeFile('authorized_users.json', JSON.stringify([ADMIN_ID]));
      console.log('Created authorized_users.json with admin ID');
    } else {
      console.error('Error checking authorized_users.json:', error);
    }
  }
}

// Start server
async function startServer() {
  try {
    console.log('Validating bot configuration...');
    await validateBot();
    await initializeAuthorizedUsers();
    
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      console.log('Bot is ready to receive messages');
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

startServer();

