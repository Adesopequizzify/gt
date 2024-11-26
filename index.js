import express from 'express';
import bodyParser from 'body-parser';
import axios from 'axios';
import FormData from 'form-data';

const app = express();
app.use(bodyParser.json());

const BOT_TOKEN = '7776989255:AAFyoeFwjAOtyHJ3o6_jv3YeSsmy6WRoiBQ';
// Update channel ID to match your actual channel
const CHANNEL_USERNAME = '@swhit_tg'; // Make sure this matches EXACTLY with your channel username
const ADMIN_ID = '6761051997';
const ADMIN_USERNAME = '@Techque_tg';

// Store active conversations and authorized users
const conversations = new Map();
const authorizedUsers = new Set([ADMIN_ID]);

// Utility function to verify channel membership and permissions
async function verifyBotChannelPermissions() {
  try {
    // First verify if bot is admin in the channel
    const chatAdmins = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getChatAdministrators`, {
      params: { chat_id: CHANNEL_USERNAME }
    });
    
    const botInfo = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
    const botId = botInfo.data.result.id;
    
    const isAdmin = chatAdmins.data.result.some(admin => 
      admin.user.id === botId && 
      (admin.status === 'administrator' || admin.status === 'creator')
    );

    if (!isAdmin) {
      throw new Error('Bot is not an administrator in the channel');
    }

    return true;
  } catch (error) {
    console.error('Channel verification failed:', error.response?.data || error.message);
    return false;
  }
}

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
      { 
        prompt: 'Enter the post content:', 
        handler: async (message) => {
          if (!message.text) return false;
          this.data.content = message.text;
          return true;
        }
      },
      { 
        prompt: 'Send an image for the post (or type "skip" to skip):',
        handler: async (message) => {
          if (message.text && message.text.toLowerCase() === 'skip') {
            return true;
          }
          if (message.photo) {
            try {
              const fileId = message.photo[message.photo.length - 1].file_id;
              const fileInfo = await getFile(fileId);
              if (!fileInfo || !fileInfo.file_path) {
                await sendMessage(this.chatId, 'Failed to process image. Please try again or type "skip".');
                return false;
              }
              this.data.image = fileId; // Store the file_id directly instead of URL
              return true;
            } catch (error) {
              console.error('Error processing image:', error);
              await sendMessage(this.chatId, 'Failed to process image. Please try again or type "skip".');
              return false;
            }
          }
          await sendMessage(this.chatId, 'Please send an image or type "skip".');
          return false;
        }
      },
      { 
        prompt: 'Enter button text (or "skip" to skip):', 
        handler: async (message) => {
          if (!message.text) return false;
          if (message.text.toLowerCase() === 'skip') {
            return true;
          }
          this.data.button = { text: message.text };
          return true;
        }
      },
      {
        prompt: 'Enter button URL (or "skip" to skip):',
        handler: async (message) => {
          if (!message.text) return false;
          if (message.text.toLowerCase() === 'skip') {
            this.data.button = null;
            return true;
          }
          if (this.data.button) {
            this.data.button.url = message.text;
          }
          return true;
        }
      },
      {
        prompt: 'Enter any additional links (format: text|url, or "done" to finish):',
        handler: async (message) => {
          if (!message.text) return false;
          if (message.text.toLowerCase() === 'done') {
            await this.finishConversation();
            return true;
          }
          const [linkText, url] = message.text.split('|');
          if (linkText && url) {
            this.data.links.push({ text: linkText.trim(), url: url.trim() });
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
    
    if (result) {
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

async function sendFormattedMessage(postData) {
  try {
    // Verify channel permissions first
    const hasPermissions = await verifyBotChannelPermissions();
    if (!hasPermissions) {
      throw new Error('Bot does not have required permissions in the channel');
    }

    const messageText = formatMessage(postData);
    const inlineKeyboard = postData.button ? 
      { inline_keyboard: [[{ text: postData.button.text, url: postData.button.url }]] } :
      undefined;

    let response;
    if (postData.image) {
      // Using file_id directly for sending photos
      const photoPayload = {
        chat_id: CHANNEL_USERNAME,
        photo: postData.image,
        caption: messageText,
        parse_mode: 'HTML'
      };

      if (inlineKeyboard) {
        photoPayload.reply_markup = JSON.stringify(inlineKeyboard);
      }

      response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, photoPayload);
    } else {
      const messagePayload = {
        chat_id: CHANNEL_USERNAME,
        text: messageText,
        parse_mode: 'HTML'
      };

      if (inlineKeyboard) {
        messagePayload.reply_markup = JSON.stringify(inlineKeyboard);
      }

      response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, messagePayload);
    }

    if (!response.data.ok) {
      throw new Error(response.data.description || 'Failed to send message to channel');
    }

    return response.data;
  } catch (error) {
    console.error('Error sending formatted message:', error.response?.data || error);
    throw new Error(`Failed to send post: ${error.response?.data?.description || error.message}`);
  }
}

async function sendMessage(chatId, text, parseMode = 'HTML', replyMarkup = null) {
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: parseMode
  };

  if (replyMarkup) {
    payload.reply_markup = typeof replyMarkup === 'string' ? replyMarkup : JSON.stringify(replyMarkup);
  }

  try {
    const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, payload);
    if (!response.data.ok) {
      throw new Error(response.data.description);
    }
    return response.data;
  } catch (error) {
    console.error('Error sending message:', error.response?.data || error);
    throw error;
  }
}

async function sendPhoto(chatId, photoId, caption, replyMarkup = null) {
  try {
    const payload = {
      chat_id: chatId,
      photo: photoId,
      caption: caption,
      parse_mode: 'HTML'
    };

    if (replyMarkup) {
      payload.reply_markup = typeof replyMarkup === 'string' ? replyMarkup : JSON.stringify(replyMarkup);
    }

    const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, payload);
    if (!response.data.ok) {
      throw new Error(response.data.description);
    }
    return response.data;
  } catch (error) {
    console.error('Error sending photo:', error.response?.data || error);
    throw new Error(error.response?.data?.description || 'Failed to send photo');
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
    throw error;
  }
}

async function handleMessage(message) {
  const { text, chat } = message;
  const chatId = chat.id.toString();

  if (text === '/start') {
    await sendMessage(chatId, 'Welcome! Here are the available commands:\n\n' +
      '/start - Show this message\n' +
      '/createnewpost - Start creating a new post');
    return;
  }

  if (!authorizedUsers.has(chatId)) {
    await requestAuthorization(message);
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

async function requestAuthorization(message) {
  const { chat } = message;
  const chatId = chat.id.toString();
  const userName = chat.username ? `@${chat.username}` : `${chat.first_name} ${chat.last_name || ''}`.trim();

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: 'Approve', callback_data: `approve_${chatId}` },
        { text: 'Reject', callback_data: `reject_${chatId}` }
      ]
    ]
  };

  await sendMessage(ADMIN_ID, `User ${userName} (ID: ${chatId}) is requesting authorization. Do you want to approve?`, 'HTML', inlineKeyboard);
  await sendMessage(chatId, 'Your authorization request has been sent to the admin. Please wait for approval.');
}

async function handleCallbackQuery(callbackQuery) {
  const { data, message } = callbackQuery;
  
  if (data === 'send_post') {
    const chatId = message.chat.id.toString();
    const conversation = conversations.get(chatId);
    if (conversation) {
      try {
        await sendFormattedMessage(conversation.data);
        await sendMessage(chatId, 'Post sent to the channel successfully!');
      } catch (error) {
        await sendMessage(chatId, `Error sending post: ${error.message}`);
      }
      conversations.delete(chatId);
    }
  } else if (data === 'edit_post') {
    const chatId = message.chat.id.toString();
    const conversation = new Conversation(chatId);
    conversations.set(chatId, conversation);
    await conversation.start();
  } else if (data === 'discard_post') {
    const chatId = message.chat.id.toString();
    await sendMessage(chatId, 'Post discarded. You can start over with /createnewpost');
    conversations.delete(chatId);
  } else {
    const [action, userId] = data.split('_');
    if (action === 'approve') {
      authorizedUsers.add(userId);
      await sendMessage(userId, 'Welcome! Your access has been approved. You can now use the bot. Type /start to see available commands.');
      await sendMessage(ADMIN_ID, `User ${userId} has been approved.`);
    } else if (action === 'reject') {
      await sendMessage(userId, 'Sorry, your access request has been denied.');
      await sendMessage(ADMIN_ID, `User ${userId} has been rejected.`);
    }
  }

  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
      callback_query_id: callbackQuery.id
    });

    // Remove the inline keyboard after admin's action
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageReplyMarkup`, {
      chat_id: message.chat.id,
      message_id: message.message_id,
      reply_markup: JSON.stringify({ inline_keyboard: [] })
    });
  } catch (error) {
    console.error('Error handling callback query:', error);
  }
}

async function sendPreview(chatId, postData) {
  try {
    const previewText = formatMessage(postData);
    await sendMessage(chatId, 'Here\'s a preview of your post:');
    
    if (postData.image) {
      try {
        await sendPhoto(chatId, postData.image, previewText);
      } catch (error) {
        console.error('Error sending photo preview:', error);
        await sendMessage(chatId, 'Failed to preview image, but the post content is:\n\n' + previewText, 'HTML', postData.button);
      }
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
  } catch (error) {
    console.error('Error sending preview:', error);
    await sendMessage(chatId, 'Error generating preview. Please try again.');
  }
}

function formatMessage(postData) {
  let messageText = `${postData.content}\n\n`;

  postData.links.forEach(link => {
    messageText += `<a href="${link.url}">${link.text}</a>\n`;
  });

  return messageText;
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server with additional error handling
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  try {
    const isValid = await validateBot();
    if (!isValid) {
      throw new Error('Bot validation failed');
    }
    
    const hasPermissions = await verifyBotChannelPermissions();
    if (!hasPermissions) {
      throw new Error('Bot does not have required permissions in the channel');
    }
    
    console.log(`Server is running on port ${PORT}`);
    console.log('Bot is ready to receive messages');
    console.log(`Channel: ${CHANNEL_USERNAME}`);
  } catch (error) {
    console.error('Startup error:', error.message);
    process.exit(1);
  }
});

      
