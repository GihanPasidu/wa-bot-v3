// 🔑 API Configuration Manager
// This file handles all API keys and external service configurations

require('dotenv').config();

// Configuration object with all API settings
const config = {
    // 🤖 Bot Configuration
    bot: {
        adminJids: [process.env.ADMIN_PHONE ? `${process.env.ADMIN_PHONE}@s.whatsapp.net` : '94788006269@s.whatsapp.net'],
        autoRead: process.env.AUTO_READ === 'true',
        antiCall: process.env.ANTI_CALL === 'true',
        botEnabled: process.env.BOT_ENABLED !== 'false',
        showConsoleQR: process.env.SHOW_CONSOLE_QR !== 'false' // Default true, set to 'false' to disable
    },

    // 🌤️ Weather API Configuration
    weather: {
        apiKey: process.env.WEATHER_API_KEY,
        baseUrl: 'https://api.openweathermap.org/data/2.5',
        enabled: !!process.env.WEATHER_API_KEY,
        fallbackMessage: '🌤️ Weather service requires API key. Add WEATHER_API_KEY to your .env file.\nGet free key: https://openweathermap.org/api'
    },

    // 🌍 Translation API Configuration
    translation: {
        googleApiKey: process.env.GOOGLE_TRANSLATE_API_KEY,
        myMemoryEmail: process.env.MYMEMORY_EMAIL,
        enabled: !!(process.env.GOOGLE_TRANSLATE_API_KEY || process.env.MYMEMORY_EMAIL),
        fallbackMessage: '🌍 Translation requires API key. Add GOOGLE_TRANSLATE_API_KEY to .env file.\nGet free key: https://cloud.google.com/translate'
    },

    // 🔗 URL Shortener Configuration
    urlShortener: {
        bitlyToken: process.env.BITLY_API_TOKEN,
        enabled: !!process.env.BITLY_API_TOKEN,
        fallbackService: 'tinyurl', // Free alternative
        fallbackMessage: '🔗 Using free TinyURL service. For Bitly, add BITLY_API_TOKEN to .env'
    },

    // 🌐 IP Geolocation Configuration
    ipApi: {
        apiKey: process.env.IPAPI_KEY,
        baseUrl: process.env.IPAPI_KEY ? 'https://ipapi.co' : 'http://ip-api.com/json',
        enabled: true, // Always enabled (free tier available)
        isPremium: !!process.env.IPAPI_KEY
    },

    // 📰 News API Configuration
    news: {
        apiKey: process.env.NEWS_API_KEY,
        baseUrl: 'https://newsapi.org/v2',
        enabled: !!process.env.NEWS_API_KEY,
        fallbackMessage: '📰 News service requires API key. Add NEWS_API_KEY to .env file.\nGet free key: https://newsapi.org/'
    },

    // 🎵 YouTube API Configuration
    youtube: {
        apiKey: process.env.YOUTUBE_API_KEY,
        baseUrl: 'https://www.googleapis.com/youtube/v3',
        enabled: !!process.env.YOUTUBE_API_KEY,
        fallbackMessage: '🎵 YouTube features require API key. Add YOUTUBE_API_KEY to .env file.'
    },

    // 🤖 AI/Chatbot Configuration
    ai: {
        openaiKey: process.env.OPENAI_API_KEY,
        huggingfaceKey: process.env.HUGGINGFACE_API_KEY,
        enabled: !!(process.env.OPENAI_API_KEY || process.env.HUGGINGFACE_API_KEY),
        fallbackMessage: '🤖 AI features require API key. Add OPENAI_API_KEY or HUGGINGFACE_API_KEY to .env'
    },

    // 💱 Currency Exchange Configuration
    currency: {
        apiKey: process.env.EXCHANGE_RATE_API_KEY,
        baseUrl: 'https://v6.exchangerate-api.com/v6',
        enabled: !!process.env.EXCHANGE_RATE_API_KEY,
        fallbackMessage: '💱 Currency exchange requires API key. Add EXCHANGE_RATE_API_KEY to .env'
    },

    // 🎮 Gaming API Configuration
    gaming: {
        steamKey: process.env.STEAM_API_KEY,
        enabled: !!process.env.STEAM_API_KEY,
        fallbackMessage: '🎮 Gaming features require Steam API key. Add STEAM_API_KEY to .env'
    },

    // 📊 Analytics Configuration
    analytics: {
        gaTrackingId: process.env.GA_TRACKING_ID,
        enabled: !!process.env.GA_TRACKING_ID
    },

    // 🌐 Server Configuration
    server: {
        port: process.env.PORT || 3000,
        nodeEnv: process.env.NODE_ENV || 'development',
        timezone: process.env.TZ || 'UTC'
    }
};

// 🔧 API Service Functions
const apiServices = {
    // 🌤️ Weather Service
    async getWeather(city) {
        if (!config.weather.enabled) {
            return { error: config.weather.fallbackMessage };
        }

        try {
            const axios = require('axios');
            const response = await axios.get(`${config.weather.baseUrl}/weather`, {
                params: {
                    q: city,
                    appid: config.weather.apiKey,
                    units: 'metric'
                }
            });

            const data = response.data;
            return {
                city: data.name,
                country: data.sys.country,
                temperature: data.main.temp,
                description: data.weather[0].description,
                humidity: data.main.humidity,
                windSpeed: data.wind.speed
            };
        } catch (error) {
            return { error: `❌ Weather data not found for "${city}". Please check city name.` };
        }
    },

    // 🔗 URL Shortener Service
    async shortenUrl(longUrl) {
        if (config.urlShortener.enabled) {
            try {
                const axios = require('axios');
                const response = await axios.post('https://api-ssl.bitly.com/v4/shorten', {
                    long_url: longUrl
                }, {
                    headers: {
                        'Authorization': `Bearer ${config.urlShortener.bitlyToken}`,
                        'Content-Type': 'application/json'
                    }
                });
                return { shortUrl: response.data.link, service: 'Bitly' };
            } catch (error) {
                // Fallback to TinyURL
                return this.tinyUrlFallback(longUrl);
            }
        } else {
            return this.tinyUrlFallback(longUrl);
        }
    },

    async tinyUrlFallback(longUrl) {
        try {
            const axios = require('axios');
            const response = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(longUrl)}`);
            return { shortUrl: response.data, service: 'TinyURL (Free)' };
        } catch (error) {
            return { error: '❌ Failed to shorten URL' };
        }
    },

    // 🌐 IP Geolocation Service
    async getIpInfo(ip) {
        try {
            const axios = require('axios');
            let url;
            
            if (config.ipApi.isPremium) {
                url = `${config.ipApi.baseUrl}/${ip}/json/?key=${config.ipApi.apiKey}`;
            } else {
                url = `${config.ipApi.baseUrl}/${ip}`;
            }

            const response = await axios.get(url);
            const data = response.data;

            return {
                ip: data.query || data.ip,
                country: data.country,
                region: data.regionName || data.region,
                city: data.city,
                isp: data.isp || data.org,
                timezone: data.timezone,
                service: config.ipApi.isPremium ? 'IPApi Pro' : 'IP-API Free'
            };
        } catch (error) {
            return { error: '❌ Failed to get IP information' };
        }
    },

    // 💱 Currency Exchange Service
    async getCurrencyRate(from, to, amount = 1) {
        if (!config.currency.enabled) {
            return { error: config.currency.fallbackMessage };
        }

        try {
            const axios = require('axios');
            const response = await axios.get(`${config.currency.baseUrl}/${config.currency.apiKey}/pair/${from}/${to}/${amount}`);
            const data = response.data;

            return {
                from: from.toUpperCase(),
                to: to.toUpperCase(),
                amount: amount,
                result: data.conversion_result,
                rate: data.conversion_rate
            };
        } catch (error) {
            return { error: '❌ Failed to get exchange rate' };
        }
    }
};

// 🔍 Configuration Status Check
function getConfigStatus() {
    const services = [];
    
    // Check each service
    if (config.weather.enabled) services.push('✅ Weather API');
    else services.push('❌ Weather API (add WEATHER_API_KEY)');
    
    if (config.translation.enabled) services.push('✅ Translation API');
    else services.push('❌ Translation API (add GOOGLE_TRANSLATE_API_KEY)');
    
    if (config.urlShortener.enabled) services.push('✅ Bitly URL Shortener');
    else services.push('⚠️ TinyURL Fallback (add BITLY_API_TOKEN for premium)');
    
    if (config.ipApi.isPremium) services.push('✅ IP Geolocation Pro');
    else services.push('⚠️ IP Geolocation Free');
    
    if (config.news.enabled) services.push('✅ News API');
    else services.push('❌ News API (add NEWS_API_KEY)');
    
    if (config.ai.enabled) services.push('✅ AI Services');
    else services.push('❌ AI Services (add OPENAI_API_KEY)');
    
    if (config.currency.enabled) services.push('✅ Currency Exchange');
    else services.push('❌ Currency Exchange (add EXCHANGE_RATE_API_KEY)');

    return services;
}

// 📋 Setup Instructions
function getSetupInstructions() {
    return `
🔑 **API SETUP INSTRUCTIONS**

1. **Copy template:** \`cp .env.template .env\`
2. **Edit .env file** and add your API keys
3. **Restart bot** to apply changes

**🆓 FREE API KEYS:**
• Weather: https://openweathermap.org/api
• Translation: https://cloud.google.com/translate  
• URL Shortener: https://bitly.com/
• News: https://newsapi.org/
• Currency: https://exchangerate-api.com/

**⚠️ Note:** Some services work without keys but with limitations.
`;
}

module.exports = {
    config,
    apiServices,
    getConfigStatus,
    getSetupInstructions
};
