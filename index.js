import express from 'express';
import bodyParser from 'body-parser';
import axios from 'axios';

const app = express();
app.use(bodyParser.json());

const BOT_TOKEN = '7715388988:AAFLf0eAkf24qzt6kIqM9ymGKXGwGSqZXBE';
const CHANNEL_USERNAME = '@swhit_tg';

// Simple message handler
async function handleMessage(message) {
  const { text, chat } = message;
  const chatId = chat.id;

  if (text === '/start') {
    try {
      // Send photo with caption and buttons
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
        chat_id: chatId,
        photo: 'https://pbs.twimg.com/profile_images/1861484836742950912/G_h1WjCH.jpg', // Replace with your paw image URL
        caption: 'Every Click in Telegram Matters!\n\nTurn Your Footprints into Rewards with PAWS!🐾',
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Open PAWS', callback_data: 'Start' }],
            [{ text: 'Join Community', url: 'https://t.me/swhit_tg' }] // Replace with your community link
          ]
        }
      });
    } catch (error) {
      console.error('Error sending message:', error.response?.data || error);
    }
  }
}

// Webhook endpoint
app.post('/webhook', async (req, res) => {
  try {
    const update = req.body;
    if (update.message) {
      await handleMessage(update.message);
    }
    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log('Bot is ready to receive messages');
});
