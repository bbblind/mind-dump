# Digital Garden Setup Guide

This guide will help you set up your Obsidian vault to automatically publish to http://andrealabate.com/mind

## What You'll Get
- Automatic sync between Obsidian and GitHub
- Beautiful web interface like https://anthonyamar.fr/Welcome+in+my+mind+🧠
- Auto-deployment when you save notes in Obsidian

## Prerequisites
✅ Obsidian installed
✅ Obsidian Git plugin installed
- [ ] GitHub account
- [ ] Node.js installed (for Quartz)

## Step 1: Initialize Git Repository

```bash
cd /Users/al/Websites/obsidian
git init
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
```

## Step 2: Install Quartz

Quartz is the static site generator that powers digital gardens like Anthony's.

```bash
# Clone Quartz into a temporary location
cd /Users/al/Websites
git clone https://github.com/jackyzha0/quartz.git quartz-temp
cd quartz-temp

# Install dependencies
npm install

# Build Quartz
npx quartz create
```

When prompted, choose:
- "Empty Quartz" or "Copy existing content"
- Set content folder to: `/Users/al/Websites/obsidian`

## Step 3: Configure Obsidian Git Plugin

In Obsidian, go to Settings → Obsidian Git:

### Automatic Settings:
- ✅ Enable "Automatic" backup
- Set "Automatic backup interval" to: **5 minutes** (or your preference)
- ✅ Enable "Auto pull" on startup
- ✅ Enable "Auto push" after commit
- Set "Commit message" to: `vault backup: {{date}}`

### Git Settings:
- Set "Author name": Your name
- Set "Author email": Your GitHub email

### Pull/Push Settings:
- ✅ Enable "Pull updates on startup"
- ✅ Enable "Push on backup"

## Step 4: Create GitHub Repository

1. Go to https://github.com/new
2. Name it: `mind-garden` (or your preference)
3. Make it **Public** (required for GitHub Pages free hosting)
4. Don't initialize with README (we already have files)
5. Create repository

## Step 5: Connect Your Vault to GitHub

```bash
cd /Users/al/Websites/obsidian
git add .
git commit -m "Initial commit: Digital garden setup"
git branch -M main
git push -u origin main
```

## Step 6: Set Up Quartz Configuration

The `quartz.config.ts` file in your vault controls how your site looks and behaves.

## Step 7: Deploy to Your Domain

### Option A: GitHub Pages (Recommended for Quick Setup)

1. Go to your repository Settings → Pages
2. Set Source to "GitHub Actions"
3. The workflow will automatically deploy your site

### Option B: Custom Domain (andrealabate.com/mind)

If you want it at http://andrealabate.com/mind, you have two options:

**Option 1: Subdomain**
1. In your DNS settings, add:
   - Type: `CNAME`
   - Name: `mind`
   - Value: `YOUR_USERNAME.github.io`

**Option 2: Subdirectory**
1. Set up a reverse proxy on your server
2. Point `/mind` to your GitHub Pages URL

## Step 8: Test Your Setup

1. Create a new note in Obsidian
2. Wait 5 minutes (or manually trigger backup: Ctrl/Cmd + P → "Obsidian Git: Backup")
3. Check your GitHub repository - the note should appear
4. Wait for GitHub Actions to deploy (~2-3 minutes)
5. Visit your site!

## Troubleshooting

### Git Authentication Issues
If you get authentication errors:
1. Generate a Personal Access Token on GitHub
2. In Obsidian Git settings, use token authentication

### Site Not Updating
1. Check GitHub Actions tab in your repository
2. Look for build errors
3. Ensure all markdown files are in the correct format

### Styling Issues
1. Check `quartz.config.ts` for theme settings
2. Customize in `quartz.layout.ts`

## Next Steps

- Customize your site appearance in `quartz.config.ts`
- Add a custom home page: Create `index.md`
- Organize with folders and tags
- Add images to `attachments/` folder

## Resources

- [Quartz Documentation](https://quartz.jzhao.xyz/)
- [Obsidian Git Plugin Guide](https://github.com/denolehov/obsidian-git)
- [Example: Anthony Amar's Garden](https://anthonyamar.fr/Welcome+in+my+mind+🧠)

