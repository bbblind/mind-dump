# 🚀 Quick Start Guide

Follow these steps to get your digital garden live!

## ✅ Checklist

- [ ] 1. Install Node.js
- [ ] 2. Create GitHub repository
- [ ] 3. Initialize Quartz
- [ ] 4. Configure Obsidian Git
- [ ] 5. Push to GitHub
- [ ] 6. Enable GitHub Pages
- [ ] 7. Configure your domain

---

## Step 1: Install Node.js

Check if you have Node.js installed:

```bash
node --version
```

If not installed, download from: https://nodejs.org/ (choose LTS version)

---

## Step 2: Create GitHub Repository

1. Go to https://github.com/new
2. Repository name: `mind-garden` (or your choice)
3. Make it **Public** ✅
4. ❌ Don't initialize with README
5. Click "Create repository"
6. **Copy the repository URL** (you'll need it next)

---

## Step 3: Initialize Quartz

Run these commands in Terminal:

```bash
# Navigate to your vault
cd /Users/al/Websites/obsidian

# Install npx if you don't have it
npm install -g npx

# Initialize Quartz
npx quartz create content

# When prompted, select:
# - "Initialize an empty Quartz"
# - Keep the default settings
```

This will download and set up Quartz in your vault.

---

## Step 4: Initialize Git and Push

```bash
# Still in /Users/al/Websites/obsidian
git init
git add .
git commit -m "Initial commit: Digital garden setup"
git branch -M main

# Replace YOUR_USERNAME and YOUR_REPO with your actual values
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

---

## Step 5: Configure Obsidian

1. **Open Obsidian**
2. Click "Open folder as vault"
3. Select: `/Users/al/Websites/obsidian`
4. Go to **Settings** (gear icon)
5. Go to **Community Plugins**
6. If you haven't already, turn off "Safe mode"
7. Find "Obsidian Git" and ensure it's enabled
8. Click the gear icon next to "Obsidian Git"

### Obsidian Git Settings:

**Backup:**
- Vault backup interval (minutes): `5`
- ✅ Auto backup after file change (optional, more aggressive)
- Commit message: `vault backup: {{date}}`

**Commit Author:**
- Author name: `Your Name`
- Author email: `your-github-email@example.com`

**Miscellaneous:**
- ✅ Pull updates on startup
- ✅ Push on backup
- ✅ Pull before push

Click **Close** to save.

---

## Step 6: Enable GitHub Pages

1. Go to your repository on GitHub
2. Click **Settings** tab
3. Click **Pages** in the left sidebar
4. Under "Build and deployment":
   - Source: **GitHub Actions** ✅
5. Wait a few minutes for the first deployment

Your site will be live at: `https://YOUR_USERNAME.github.io/YOUR_REPO/`

---

## Step 7: Test the Setup

1. Create a new note in Obsidian
2. Write something like:

```markdown
---
title: My First Note
---

# Hello World!

This is my first note in my digital garden!
```

3. Wait 5 minutes OR manually trigger backup:
   - Press `Cmd/Ctrl + P`
   - Type "Obsidian Git: Backup"
   - Press Enter

4. Check GitHub - your note should appear!
5. Wait 2-3 minutes for GitHub Actions to deploy
6. Visit your site!

---

## Step 8: Configure Custom Domain (andrealabate.com/mind)

### Option A: Use Subdomain (mind.andrealabate.com)

**In your DNS provider:**
1. Add new record:
   - Type: `CNAME`
   - Name: `mind`
   - Value: `YOUR_USERNAME.github.io`
   - TTL: `3600` (or automatic)

**In GitHub repository settings:**
1. Go to Settings → Pages
2. Custom domain: `mind.andrealabate.com`
3. ✅ Enforce HTTPS (after DNS propagates)

### Option B: Use Subdirectory (andrealabate.com/mind)

This requires your main site to proxy requests. Contact your hosting provider or:

1. If you use **Apache**, add to `.htaccess`:

```apache
RewriteEngine On
RewriteRule ^mind/(.*)$ https://YOUR_USERNAME.github.io/YOUR_REPO/$1 [P,L]
```

2. If you use **Nginx**, add to config:

```nginx
location /mind/ {
    proxy_pass https://YOUR_USERNAME.github.io/YOUR_REPO/;
}
```

---

## 🎉 You're Done!

Your digital garden is now:
- ✅ Syncing automatically from Obsidian
- ✅ Building automatically with Quartz
- ✅ Deploying automatically to your domain
- ✅ Looking beautiful!

## What's Next?

- **Customize appearance**: Edit `quartz.config.ts`
- **Customize layout**: Edit `quartz.layout.ts`
- **Add content**: Start writing notes in Obsidian!
- **Organize**: Create folders for different topics
- **Connect**: Link notes together with `[[links]]`

---

## 🆘 Troubleshooting

### "Git authentication failed"

1. Generate a Personal Access Token: https://github.com/settings/tokens
2. In Obsidian Git settings, use token for authentication

### "GitHub Actions failing"

1. Check the Actions tab in your GitHub repo
2. Look at the error logs
3. Common issue: Quartz not installed - run `npx quartz create content`

### "Site not updating"

1. Check if Git is pushing: Look at your GitHub repo
2. Check if Actions are running: Go to Actions tab
3. Force a rebuild: Go to Actions → Deploy → Run workflow

### "Links broken on site"

1. Make sure you're using `[[wikilinks]]` format
2. Check that file names match exactly (case-sensitive)

---

## 📚 Learn More

- [Quartz Documentation](https://quartz.jzhao.xyz/)
- [Obsidian Help](https://help.obsidian.md/)
- [Digital Garden Philosophy](https://maggieappleton.com/garden-history)
- [Example: Anthony's Garden](https://anthonyamar.fr/Welcome+in+my+mind+🧠)

**Need help?** Open an issue in your GitHub repository!

