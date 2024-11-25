import express from 'express';
import bodyParser from 'body-parser';
import axios from 'axios';

const app = express();
app.use(bodyParser.json());

const BOT_TOKEN = '7653336178:AAE8KKXEKFILBP6j86OvsYWFPKq4DPnXlmA';
const CHANNEL_ID = '@swhit_tg';

// Store active conversations
const conversations = new Map();

// Conversation state handler
class Conversation {
  constructor(chatId) {
    this.chatId = chatId;
    this.currentStep = 0;
    this.data = {
      title: '',
      content: '',
      button: null,
      links: []
    };
    this.steps = [
      { prompt: 'Enter the post title:', handler: (text) => this.data.title = text },
      { prompt: 'Enter the post content:', handler: (text) => this.data.content = text },
      { 
        prompt: 'Enter button text (or "skip" to skip):', 
        handler: (text) => {
          if (text.toLowerCase() !== 'skip') {
            this.data.button = { text };
          }
        }
      },
      {
        prompt: 'Enter button URL (or "skip" to skip):',
        handler: (text) => {
          if (this.data.button && text.toLowerCase() !== 'skip') {
            this.data.button.url = text;
          }
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

  async handleResponse(text) {
    if (this.currentStep >= this.steps.length) return;

    const step = this.steps[this.currentStep];
    const result = await step.handler(text);
    
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
    await sendMessage(chatId, 'Bot is active and ready to create posts! Use /createnewpost to begin.');
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
    await activeConversation.handleResponse(text);
  }
}

async function sendPreview(chatId, postData) {
  const previewText = formatMessage(postData);
  await sendMessage(chatId, 'Here\'s a preview of your post:');
  await sendMessage(chatId, previewText, 'HTML', postData.button);
  await sendMessage(chatId, 'Do you want to send this post? (yes/no)');

  // Create a new conversation for the confirmation
  const confirmConversation = new Map();
  confirmConversation.set(chatId, async (response) => {
    if (response.toLowerCase() === 'yes') {
      await sendFormattedMessage(postData);
      await sendMessage(chatId, 'Post sent to the channel successfully!');
    } else {
      await sendMessage(chatId, 'Post cancelled. You can start over with /createnewpost');
    }
    confirmConversation.delete(chatId);
  });
}

function formatMessage(postData) {
  let messageText = `<b>${postData.title}</b>\n\n${postData.content}\n\n`;

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
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: CHANNEL_ID,
      text: messageText,
      parse_mode: 'HTML',
      reply_markup: inlineKeyboard
    });
  } catch (error) {
    console.error('Error sending message:', error.response?.data || error.message);
  }
}

async function sendMessage(chatId, text, parseMode = 'HTML', button = null) {
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: parseMode
  };

  if (button) {
    payload.reply_markup = {
      inline_keyboard: [[{ text: button.text, url: button.url }]]
    };
  }

  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, payload);
  } catch (error) {
    console.error('Error sending message:', error.response?.data || error.message);
  }
}

// Webhook endpoint
app.post('/webhook', async (req, res) => {
  try {
    const { message } = req.body;
    if (message && message.text) {
      await handleMessage(message);
    }
    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error);
    res.sendStatus(500);
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  const isValid = await validateBot();
  if (isValid) {
    console.log(`Server is running on port ${PORT}`);
    console.log('Bot is ready to receive messages');
  } else {
    console.error('Bot validation failed. Shutting down...');
    process.exit(1);
  }
});
