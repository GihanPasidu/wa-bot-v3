# WhatsApp Bot

A powerful WhatsApp bot that can scan QR codes, connect to your WhatsApp account, and provide various bot commands for account management.

## Features

- 🔐 **QR Code Authentication** - Scan QR code to connect your WhatsApp account
- 🤖 **Bot Commands** - Multiple commands for account management
- 📱 **Auto Status View** - Automatically mark status messages as read
- 📞 **Call Blocking** - Block incoming calls when enabled
- 🎨 **Sticker Creation** - Convert images to WhatsApp stickers
- 🛡️ **Admin Controls** - Secure command access for administrators

## Bot Commands

| Command | Description |
|---------|-------------|
| `.panel` | Show control panel menu with all available options |
| `.autoread` | Toggle auto status view (mark status as read automatically) |
| `.anticall` | Toggle call blocking feature |
| `.sticker` | Create sticker from image (send image with this command) |

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

### Control Panel
Send `.panel` to see all available commands and current status.

### Auto Status View
Send `.autoread` to toggle automatic status viewing on/off.

### Call Blocking
Send `.anticall` to toggle call blocking on/off.

### Sticker Creation
1. Send an image to the bot
2. Add `.sticker` as a caption or send `.sticker` after the image
3. The bot will convert the image to a WhatsApp sticker

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
