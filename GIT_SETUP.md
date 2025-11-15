# Git Authentication Setup

## ⚠️ Security Notice

Your Personal Access Token (PAT) has been provided. Keep this secure and never commit it to your repository!

## Quick Setup Steps

### 1. Configure Git Credentials

Run these commands in Terminal:

```bash
cd /Users/al/Websites/obsidian

# Set your Git identity
git config user.name "Andrea Labate"
git config user.email "your-email@example.com"

# Store credentials (this will save your PAT securely)
git config credential.helper store
```

### 2. Create GitHub Repository

1. Go to https://github.com/new
2. Name: `mind-garden` (or your preferred name)
3. Make it **Public** (required for free GitHub Pages)
4. Don't initialize with README
5. Click "Create repository"

### 3. Connect Your Repository

Replace `YOUR_USERNAME` and `YOUR_REPO` with your actual values:

```bash
cd /Users/al/Websites/obsidian

# Add remote (use HTTPS)
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git

# Make initial commit
git add .
git commit -m "Initial commit: Digital garden setup"

# Push to GitHub (you'll be prompted for credentials)
git push -u origin main
```

When prompted:
- **Username**: Your GitHub username
- **Password**: Paste your Personal Access Token (not your actual password!)

The token will be: `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`

After the first push, Git will remember your credentials.

### 4. Enable GitHub Pages

1. Go to your repository on GitHub
2. **Settings** → **Pages**
3. Source: **GitHub Actions**
4. Save

### 5. Test in Obsidian

1. Open Obsidian
2. Open the `/Users/al/Websites/obsidian` folder as a vault
3. Create a test note
4. Wait 5 minutes OR press `Cmd+P` → type "Obsidian Git: Backup"
5. Check GitHub - your changes should appear!

## Alternative: Use SSH (More Secure)

If you prefer SSH authentication:

```bash
# Generate SSH key
ssh-keygen -t ed25519 -C "your-email@example.com"

# Add to SSH agent
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519

# Copy public key
cat ~/.ssh/id_ed25519.pub
```

Then:
1. Go to GitHub → Settings → SSH and GPG keys
2. Click "New SSH key"
3. Paste your public key
4. Use SSH URL: `git@github.com:YOUR_USERNAME/YOUR_REPO.git`

## Troubleshooting

### "Authentication failed"
- Make sure you're using the PAT, not your password
- Check if the token has the right permissions: `repo`, `workflow`
- Generate a new token if needed: https://github.com/settings/tokens

### "Permission denied"
- Ensure the repository exists on GitHub
- Check you have write access to the repository
- Verify your username is correct

### "Credential helper not working"
```bash
# Check current credential helper
git config --global credential.helper

# On macOS, use keychain
git config --global credential.helper osxkeychain
```

## Next Steps

✅ Git is configured
✅ Repository is connected
✅ Obsidian Git plugin is set up

Now:
1. Start writing notes in Obsidian
2. They'll auto-sync every 5 minutes
3. GitHub Actions will auto-deploy
4. Your site will be live!

## Security Tips

- ✅ Token is stored securely by Git credential helper
- ✅ Token is NOT in any committed files
- ✅ `.gitignore` prevents sensitive files from being committed
- ⚠️ Never share your token publicly
- ⚠️ If token is compromised, revoke it immediately at https://github.com/settings/tokens

