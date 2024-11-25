import express from 'express';
import bodyParser from 'body-parser';
import axios from 'axios';

const app = express();
app.use(bodyParser.json());

const BOT_TOKEN = '7653336178:AAE8KKXEKFILBP6j86OvsYWFPKq4DPnXlmA';
const CHANNEL_ID = '@swhit_tg';

async function validateBot() {
  if (!BOT_TOKEN) {
    throw new Error('BOT_TOKEN is not set');
  }
  if (!CHANNEL_ID) {
    throw new Error('CHANNEL_ID is not set');
  }

  try {
    const response = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
    console.log('Bot validation successful:', response.data.result.username);
    
    const channelTest = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getChat`, {
      params: { chat_id: CHANNEL_ID }
    });
    console.log('Channel validation successful:', channelTest.data.result.title);
    
    return true;
  } catch (error) {
    console.error('Bot validation failed:', error.response?.data || error.message);
    throw new Error('Bot validation failed');
  }
}

async function handleMessage(message) {
  const { text, chat } = message;
  console.log('Received message:', text);

  if (text === '/start') {
    await sendMessage(chat.id, 'Bot is active and ready to create posts! Use /createnewpost to begin.');
  } else if (text === '/createnewpost') {
    await startNewPost(chat.id);
  }
}

async function startNewPost(chatId) {
  console.log('Starting new post for chat ID:', chatId);
  const steps = [
    'Enter the post title:',
    'Enter the post content:',
    'Enter button text (or "skip" to skip):',
    'Enter button URL (or "skip" to skip):',
    'Enter any additional links (format: text|url, or "done" to finish):'
  ];

  let postData = {
    title: '',
    content: '',
    button: null,
    links: []
  };

  for (let i = 0; i < steps.length; i++) {
    await sendMessage(chatId, steps[i]);
    const response = await waitForResponse(chatId);
    console.log(`Step ${i + 1} response:`, response);

    switch (i) {
      case 0:
        postData.title = response;
        break;
      case 1:
        postData.content = response;
        break;
      case 2:
        if (response.toLowerCase() !== 'skip') {
          postData.button = { text: response };
        }
        break;
      case 3:
        if (postData.button && response.toLowerCase() !== 'skip') {
          postData.button.url = response;
        }
        break;
      case 4:
        while (response.toLowerCase() !== 'done') {
          const [text, url] = response.split('|');
          if (text && url) {
            postData.links.push({ text, url });
          }
          await sendMessage(chatId, 'Enter next link (or "done" to finish):');
          response = await waitForResponse(chatId);
          console.log('Additional link response:', response);
        }
        break;
    }
  }

  await sendPreview(chatId, postData);
}

async function sendPreview(chatId, postData) {
  console.log('Sending preview for chat ID:', chatId);
  const previewText = formatMessage(postData);
  await sendMessage(chatId, 'Here\'s a preview of your post:');
  await sendMessage(chatId, previewText, 'HTML', postData.button);
  await sendMessage(chatId, 'Do you want to send this post? (yes/no)');

  const response = await waitForResponse(chatId);
  console.log('Preview response:', response);
  if (response.toLowerCase() === 'yes') {
    await sendFormattedMessage(postData);
    await sendMessage(chatId, 'Post sent to the channel successfully!');
  } else {
    await sendMessage(chatId, 'Post cancelled. You can start over with /createnewpost');
  }
}

function formatMessage(postData) {
  let messageText = `<b>${postData.title}</b>\n\n${postData.content}\n\n`;

  postData.links.forEach(link => {
    messageText += `<a href="${link.url}">${link.text}</a>\n`;
  });

  return messageText;
}

async function sendFormattedMessage(postData) {
  console.log('Sending formatted message to channel:', CHANNEL_ID);
  const messageText = formatMessage(postData);

  const inlineKeyboard = postData.button ? 
    { inline_keyboard: [[{ text: postData.button.text, url: postData.button.url }]] } :
    undefined;

  try {
    const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: CHANNEL_ID,
      text: messageText,
      parse_mode: 'HTML',
      reply_markup: inlineKeyboard
    });
    console.log('Message sent successfully:', response.data);
  } catch (error) {
    console.error('Error sending message:', error.response ? error.response.data : error.message);
  }
}

async function sendMessage(chatId, text, parseMode = 'HTML', button = null) {
  console.log(`Sending message to chat ID ${chatId}:`, text);
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
    const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, payload);
    console.log('Message sent successfully:', response.data);
  } catch (error) {
    console.error('Error sending message:', error.response ? error.response.data : error.message);
  }
}

function waitForResponse(chatId) {
  console.log(`Waiting for response from chat ID:`, chatId);
  return new Promise((resolve) => {
    app.once('message', (message) => {
      if (message.chat.id === chatId) {
        console.log('Received response:', message.text);
        resolve(message.text);
      }
    });
  });
}

app.post('/webhook', async (req, res) => {
  try {
    console.log('Received webhook:', req.body);
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

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

async function startServer() {
  try {
    console.log('Validating bot configuration...');
    await validateBot();
    
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

console.log('Testing bot configuration...');
validateBot()
  .then(() => console.log('Bot configuration is valid'))
  .catch(error => {
    console.error('Bot configuration is invalid:', error.message);
    process.exit(1);
  });

