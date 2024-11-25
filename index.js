import express from 'express';
import bodyParser from 'body-parser';
import axios from 'axios';

const app = express();
app.use(bodyParser.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;

// Webhook endpoint
app.post('/webhook', async (req, res) => {
  const { message } = req.body;
  if (message && message.text) {
    await handleMessage(message);
  }
  res.sendStatus(200);
});

async function handleMessage(message) {
  const { text, chat } = message;

  if (text === '/createnewpost') {
    await startNewPost(chat.id);
  }
}

async function startNewPost(chatId) {
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
        }
        break;
    }
  }

  await sendPreview(chatId, postData);
}

async function sendPreview(chatId, postData) {
  const previewText = formatMessage(postData);
  await sendMessage(chatId, 'Here\'s a preview of your post:');
  await sendMessage(chatId, previewText, 'HTML', postData.button);
  await sendMessage(chatId, 'Do you want to send this post? (yes/no)');

  const response = await waitForResponse(chatId);
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
  const messageText = formatMessage(postData);

  const inlineKeyboard = postData.button ? 
    { inline_keyboard: [[{ text: postData.button.text, url: postData.button.url }]] } :
    undefined;

  await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    chat_id: CHANNEL_ID,
    text: messageText,
    parse_mode: 'HTML',
    reply_markup: inlineKeyboard
  });
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

  await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, payload);
}

function waitForResponse(chatId) {
  return new Promise((resolve) => {
    app.once('message', (message) => {
      if (message.chat.id === chatId) {
        resolve(message.text);
      }
    });
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// For testing purposes
console.log('Telegram Bot Webhook is set up and running!');
