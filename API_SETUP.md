# 🔑 API Configuration Guide

This guide will help you set up API keys for your WhatsApp bot to unlock powerful features like weather, URL shortening, currency exchange, and more!

## 🚀 Quick Setup (Recommended)

### Option 1: Interactive Setup Script
```bash
npm run setup
```
This will guide you through configuring all APIs step by step.

### Option 2: Manual Setup
1. Copy the template: `cp .env.template .env`
2. Edit `.env` and add your API keys
3. Restart the bot

## 🆓 Free API Keys & Services

### 🌤️ Weather API (OpenWeatherMap)
- **Website:** https://openweathermap.org/api
- **Free Tier:** 1,000 calls/day
- **Steps:**
  1. Sign up at openweathermap.org
  2. Go to API Keys section
  3. Copy your API key
  4. Add to `.env`: `WEATHER_API_KEY=your_key_here`

### 🌍 Translation API (Google Translate)
- **Website:** https://cloud.google.com/translate
- **Free Tier:** 500,000 characters/month
- **Steps:**
  1. Go to Google Cloud Console
  2. Enable Translation API
  3. Create credentials (API key)
  4. Add to `.env`: `GOOGLE_TRANSLATE_API_KEY=your_key_here`

### 🔗 URL Shortener (Bitly)
- **Website:** https://bitly.com/
- **Free Tier:** 1,000 links/month
- **Fallback:** TinyURL (unlimited, no key needed)
- **Steps:**
  1. Sign up at bitly.com
  2. Go to Settings → API
  3. Generate access token
  4. Add to `.env`: `BITLY_API_TOKEN=your_token_here`

### 🌐 IP Geolocation (IP-API)
- **Free Service:** http://ip-api.com/ (no key needed)
- **Premium Service:** https://ipapi.co/ (10,000 requests/month free)
- **Steps for Premium:**
  1. Sign up at ipapi.co
  2. Get your API key
  3. Add to `.env`: `IPAPI_KEY=your_key_here`

### 💱 Currency Exchange (ExchangeRate-API)
- **Website:** https://exchangerate-api.com/
- **Free Tier:** 1,500 requests/month
- **Steps:**
  1. Sign up at exchangerate-api.com
  2. Copy your API key from dashboard
  3. Add to `.env`: `EXCHANGE_RATE_API_KEY=your_key_here`

### 📰 News API (Optional)
- **Website:** https://newsapi.org/
- **Free Tier:** 1,000 requests/day
- **Steps:**
  1. Sign up at newsapi.org
  2. Get your API key
  3. Add to `.env`: `NEWS_API_KEY=your_key_here`

## 🛠️ Configuration File (.env)

Create a `.env` file in your project root:

```bash
# Weather API
WEATHER_API_KEY=your_openweather_api_key_here

# Translation API
GOOGLE_TRANSLATE_API_KEY=your_google_translate_key_here

# URL Shortener
BITLY_API_TOKEN=your_bitly_token_here

# IP Geolocation (optional - works without key)
IPAPI_KEY=your_ipapi_key_here

# Currency Exchange
EXCHANGE_RATE_API_KEY=your_exchange_rate_key_here

# Bot Configuration
ADMIN_PHONE=94752735513
AUTO_READ=false
ANTI_CALL=false
BOT_ENABLED=true

# Deployment Settings
PORT=3000
NODE_ENV=production
TZ=UTC
```

## 🎯 Available Commands with APIs

### ✅ With API Keys Configured
```
.weather London          → Real weather data
.shorturl https://...     → Bitly shortened URLs  
.ip 8.8.8.8              → Detailed IP information
.currency USD EUR 100    → Live exchange rates
.apiconfig               → Check API status
```

### ⚠️ Without API Keys (Fallback)
```
.weather London          → Shows setup instructions
.shorturl https://...     → Uses free TinyURL
.ip 8.8.8.8              → Basic free IP lookup
.currency USD EUR        → Shows setup instructions
```

## 🔧 Testing Your Setup

1. **Start the bot:**
   ```bash
   npm start
   ```

2. **Check API status:**
   Send `.apiconfig` to your bot

3. **Test individual services:**
   ```
   .weather New York
   .shorturl https://google.com
   .ip 1.1.1.1
   .currency USD EUR 100
   ```

## 🚨 Security & Best Practices

### 🔐 Keep API Keys Secret
- ✅ Never commit `.env` files to GitHub
- ✅ Use environment variables in production
- ✅ Regenerate keys if accidentally exposed

### 📊 Monitor Usage
- Check your API dashboards regularly
- Set up usage alerts
- Consider upgrading plans if needed

### 🔄 Backup Configuration
- Save your `.env` file securely
- Document which services you're using
- Keep API key recovery information

## 🎊 Advanced Features (Optional)

### 🤖 AI Integration
```bash
# OpenAI ChatGPT
OPENAI_API_KEY=your_openai_key

# Hugging Face
HUGGINGFACE_API_KEY=your_huggingface_key
```

### 🎮 Gaming APIs
```bash
# Steam API
STEAM_API_KEY=your_steam_key
```

### 📊 Analytics
```bash
# Google Analytics
GA_TRACKING_ID=your_ga_id
```

## 🆘 Troubleshooting

### ❌ "API key required" errors
- Check your `.env` file exists
- Verify key names match exactly
- Restart the bot after adding keys

### ❌ "Invalid API key" errors  
- Double-check the key is correct
- Ensure no extra spaces or characters
- Check if the API service is active

### ❌ "Rate limit exceeded" errors
- You've hit the free tier limits
- Wait for reset or upgrade plan
- Consider using fallback services

## 🎉 Success!

Once configured, your bot will have:
- 🌤️ Real-time weather data
- 🔗 Professional URL shortening
- 🌐 Detailed IP geolocation
- 💱 Live currency exchange rates
- 📊 API status monitoring

**Happy botting! 🤖✨**
