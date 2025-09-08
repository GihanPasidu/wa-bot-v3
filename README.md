# WhatsApp Bot

A powerful WhatsApp bot that can scan QR codes, connect to your WhatsApp account, and provide various bot commands for account management.

## Features

- 🔐 **QR Code Authentication** - Scan QR code to connect your WhatsApp account
- 🤖 **Rich Command Set** - 25+ commands for various functions
- 🎲 **Fun Commands** - Jokes, quotes, dice, coin flip, 8-ball, and more
- 🔧 **Utility Tools** - Calculator, password generator, time, weather info
- 🎨 **Media Processing** - Create stickers, convert sticker to image
- 📱 **Auto Status View** - Automatically mark status messages as read
- 📞 **Call Blocking** - Block incoming calls when enabled
- 👑 **Group Management** - Complete admin tools for group control
- 📊 **Statistics** - Track bot usage and performance
- 🛡️ **Security Features** - Anti-link protection, warning system
- ⚡ **Fast Response** - Built with Baileys for optimal performance

## Bot Commands

### Quick Commands
| Command | Description |
|---------|-------------|
| `.help` | Complete list of all commands |
| `.panel` | Main control panel with status |
| `.ping` | Check bot response time |
| `.stats` | Bot statistics and uptime |
| `.about` | Information about the bot |

### Fun Commands
| Command | Description |
|---------|-------------|
| `.quote` | Random inspirational quote |
| `.joke` | Random joke |
| `.fact` | Random fun fact |
| `.dice [sides]` | Roll a dice (default 6 sides) |
| `.coin` | Flip a coin |
| `.8ball [question]` | Magic 8-ball answers |

### Utility Commands
| Command | Description |
|---------|-------------|
| `.calc [expression]` | Basic calculator |
| `.time` | Current date and time |
| `.pass [length]` | Generate secure password |
| `.weather [city]` | Weather info (demo) |
| `.qr [text]` | Generate QR code info |

### Media Commands
| Command | Description |
|---------|-------------|
| `.sticker` | Convert image to WhatsApp sticker |
| `.toimg` | Convert sticker to image |

### Settings Commands
| Command | Description |
|---------|-------------|
| `.autoread` | Toggle auto status view |
| `.anticall` | Toggle call blocking |
| `.on` / `.off` | Enable/disable bot |

### Group Management (Admin Only)
| Command | Description |
|---------|-------------|
| `.ghelp` | Show all group commands |
| `.ginfo` | Show group information |
| `.kick @user` | Remove member from group |
| `.promote @user` | Make member admin |
| `.demote @user` | Remove admin privileges |
| `.mute [duration]` | Mute group (e.g., 5m, 1h, 1d) |
| `.unmute` | Unmute group |
| `.warn @user` | Issue warning to member |
| `.lock` / `.unlock` | Lock/unlock group |
| `.antilink on/off` | Toggle link protection |

## Installation

1. **Clone or download this repository**
   ```bash
   git clone <repository-url>
   cd wa-bot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure the bot**
   - Open `bot.js` in a text editor
   - Find the line with `YOUR_PHONE_NUMBER@c.us` and replace it with your phone number
   - Add your phone number to the `adminNumbers` array if you want admin access

4. **Run the bot**
   ```bash
   npm start
   ```

## Setup Instructions

1. **First Run:**
   - Run `npm start` to start the bot
   - A QR code will appear in your terminal
   - Open WhatsApp on your phone
   - Go to Settings > Linked Devices > Link a Device
   - Scan the QR code displayed in the terminal

2. **After Connection:**
   - The bot will be ready and listening for commands
   - You can now use the bot commands in any WhatsApp chat
   - The bot will respond to commands sent to it

## Usage Examples

### Quick Start
Send `.help` to see all available commands or `.panel` for the main control panel.

### Fun Commands
- `.joke` - Get a random joke
- `.quote` - Get inspirational quote
- `.dice 20` - Roll a 20-sided dice
- `.8ball Will I be successful?` - Ask the magic 8-ball

### Utility Commands
- `.calc 15 * 7 + 3` - Use the calculator
- `.pass 16` - Generate a 16-character password
- `.time` - Check current date and time

### Media Commands
1. **Create Sticker**: Send an image with `.sticker` caption
2. **Convert Sticker**: Reply to a sticker with `.toimg`

### Group Management
- `.ginfo` - View group details
- `.mute 1h` - Mute group for 1 hour
- `.warn @username` - Issue warning to member

## Configuration

### Admin Settings
To set up admin access, modify the `config` object in `bot.js`:

```javascript
const config = {
    autoRead: false,
    antiCall: false,
    adminNumbers: ['1234567890@c.us'] // Add your phone number here
};
```

### Phone Number Format
Use the format: `COUNTRY_CODE + PHONE_NUMBER@c.us`
- Example: `1234567890@c.us` for US number +1 (234) 567-890

## Troubleshooting

### Common Issues

1. **QR Code not appearing:**
   - Make sure you have a stable internet connection
   - Try running the bot again with `npm start`

2. **Bot not responding to commands:**
   - Check if your phone number is correctly configured
   - Ensure the bot is connected (check console for "ready" message)

3. **Sticker creation fails:**
   - Make sure you're sending a valid image file
   - Check that the image is not too large

4. **Permission errors:**
   - Some commands require admin access
   - Make sure your number is in the `adminNumbers` array

### Logs
The bot provides detailed console logs for debugging. Check the terminal output for any error messages.

## Security Notes

- The bot stores session data locally for automatic reconnection
- Admin commands are restricted to configured phone numbers
- The bot only responds to messages sent directly to it
- Session data is stored in the `.wwebjs_auth` folder

## Dependencies

- `whatsapp-web.js` - WhatsApp Web API wrapper
- `qrcode-terminal` - QR code generation for terminal
- `fs` - File system operations
- `path` - Path utilities

## License

MIT License - feel free to modify and distribute.

## Support

If you encounter any issues:
1. Check the troubleshooting section above
2. Verify your configuration settings
3. Check the console logs for error messages
4. Ensure all dependencies are properly installed

---

**Note:** This bot is for personal use only. Make sure to comply with WhatsApp's Terms of Service when using this bot.
