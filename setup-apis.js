#!/usr/bin/env node

// 🔑 Easy API Setup Script for WhatsApp Bot

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log('🤖 WhatsApp Bot - API Configuration Setup');
console.log('==========================================\n');

// Check if .env already exists
const envPath = path.join(__dirname, '.env');
const templatePath = path.join(__dirname, '.env.template');

if (fs.existsSync(envPath)) {
    console.log('⚠️  .env file already exists!');
    rl.question('Do you want to overwrite it? (y/N): ', (answer) => {
        if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
            startSetup();
        } else {
            console.log('✅ Setup cancelled. Edit your .env file manually.');
            rl.close();
        }
    });
} else {
    startSetup();
}

function startSetup() {
    console.log('\n🔧 Let\'s configure your API keys!\n');
    console.log('💡 Tip: Press ENTER to skip any service you don\'t want to configure.\n');
    
    const config = {};
    
    // Start configuration wizard
    askWeatherAPI();
    
    function askWeatherAPI() {
        console.log('🌤️  WEATHER API');
        console.log('   Get free key: https://openweathermap.org/api');
        rl.question('   Enter Weather API key (or press ENTER to skip): ', (key) => {
            if (key.trim()) config.WEATHER_API_KEY = key.trim();
            askTranslationAPI();
        });
    }
    
    function askTranslationAPI() {
        console.log('\n🌍 TRANSLATION API');
        console.log('   Get free key: https://cloud.google.com/translate');
        rl.question('   Enter Google Translate API key (or press ENTER to skip): ', (key) => {
            if (key.trim()) config.GOOGLE_TRANSLATE_API_KEY = key.trim();
            askBitlyAPI();
        });
    }
    
    function askBitlyAPI() {
        console.log('\n🔗 URL SHORTENER API');
        console.log('   Get free token: https://bitly.com/');
        rl.question('   Enter Bitly API token (or press ENTER for free TinyURL): ', (key) => {
            if (key.trim()) config.BITLY_API_TOKEN = key.trim();
            askIPAPI();
        });
    }
    
    function askIPAPI() {
        console.log('\n🌐 IP GEOLOCATION API');
        console.log('   Get free key: https://ipapi.co/');
        rl.question('   Enter IP API key (or press ENTER for free tier): ', (key) => {
            if (key.trim()) config.IPAPI_KEY = key.trim();
            askCurrencyAPI();
        });
    }
    
    function askCurrencyAPI() {
        console.log('\n💱 CURRENCY EXCHANGE API');
        console.log('   Get free key: https://exchangerate-api.com/');
        rl.question('   Enter Exchange Rate API key (or press ENTER to skip): ', (key) => {
            if (key.trim()) config.EXCHANGE_RATE_API_KEY = key.trim();
            askAdminPhone();
        });
    }
    
    function askAdminPhone() {
        console.log('\n📱 BOT CONFIGURATION');
        rl.question('   Enter your phone number (with country code, no +): ', (phone) => {
            if (phone.trim()) config.ADMIN_PHONE = phone.trim();
            askBotSettings();
        });
    }
    
    function askBotSettings() {
        rl.question('   Enable auto-read messages? (y/N): ', (autoRead) => {
            config.AUTO_READ = (autoRead.toLowerCase() === 'y' || autoRead.toLowerCase() === 'yes').toString();
            
            rl.question('   Enable anti-call blocking? (y/N): ', (antiCall) => {
                config.ANTI_CALL = (antiCall.toLowerCase() === 'y' || antiCall.toLowerCase() === 'yes').toString();
                generateEnvFile();
            });
        });
    }
    
    function generateEnvFile() {
        console.log('\n📄 Generating .env file...');
        
        // Read template
        let envContent = '';
        if (fs.existsSync(templatePath)) {
            envContent = fs.readFileSync(templatePath, 'utf8');
        }
        
        // Replace values
        Object.keys(config).forEach(key => {
            const value = config[key];
            const regex = new RegExp(`${key}=.*`, 'g');
            if (envContent.match(regex)) {
                envContent = envContent.replace(regex, `${key}=${value}`);
            } else {
                envContent += `\n${key}=${value}`;
            }
        });
        
        // Write .env file
        fs.writeFileSync(envPath, envContent);
        
        console.log('✅ .env file created successfully!');
        console.log('\n🎉 Configuration Summary:');
        console.log('========================');
        
        Object.keys(config).forEach(key => {
            const value = config[key];
            if (key.includes('KEY') || key.includes('TOKEN')) {
                console.log(`✅ ${key}: ${value ? '***configured***' : 'not set'}`);
            } else {
                console.log(`✅ ${key}: ${value}`);
            }
        });
        
        console.log('\n🚀 Next Steps:');
        console.log('1. Run: npm install');
        console.log('2. Run: npm start');
        console.log('3. Scan QR code to connect WhatsApp');
        console.log('4. Test your API-powered commands!');
        
        console.log('\n💡 Available Commands:');
        console.log('• .weather <city> - Weather information');
        console.log('• .shorturl <url> - URL shortener');
        console.log('• .ip <address> - IP geolocation');
        console.log('• .currency USD EUR - Currency exchange');
        console.log('• .apiconfig - Check API status');
        
        rl.close();
    }
}

rl.on('close', () => {
    console.log('\n👋 Setup complete! Happy botting!');
    process.exit(0);
});
