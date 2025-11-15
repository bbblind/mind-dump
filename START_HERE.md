# 🚀 START HERE - Complete Setup in 10 Minutes

Your digital garden is ready to go! Follow these steps exactly.

---

## Step 1: Install Node.js (if needed)

Check if you have it:
```bash
node --version
```

If not installed: Download from https://nodejs.org/ (LTS version)

---

## Step 2: Create GitHub Repository

1. Go to: https://github.com/new
2. Repository name: `mind-garden`
3. **Public** repository ✅
4. Don't initialize with anything
5. Click "Create repository"
6. **Copy the repository URL** (looks like: `https://github.com/YOUR_USERNAME/mind-garden.git`)

---

## Step 3: Run These Commands

Open Terminal and run these commands **one by one**:

```bash
# Navigate to your vault
cd /Users/al/Websites/obsidian

# Configure Git
git config user.name "Andrea Labate"
git config user.email "YOUR_EMAIL@example.com"
git config credential.helper osxkeychain

# Initialize Quartz
npx quartz create content
```

When Quartz asks questions, choose:
- **"Empty Quartz"**
- Keep all default settings (just press Enter)

```bash
# Initialize Git repository
git init
git add .
git commit -m "Initial commit: Digital garden setup"
git branch -M main

# Connect to GitHub (REPLACE with your actual repository URL)
git remote add origin https://github.com/YOUR_USERNAME/mind-garden.git

# Push to GitHub
git push -u origin main
```

**When prompted for credentials:**
- Username: `YOUR_GITHUB_USERNAME`
- Password: `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`

---

## Step 4: Enable GitHub Pages

1. Go to your repository: `https://github.com/YOUR_USERNAME/mind-garden`
2. Click **Settings** tab
3. Click **Pages** in left sidebar
4. Under "Build and deployment":
   - Source: Select **GitHub Actions**
5. Done! Your site will be at: `https://YOUR_USERNAME.github.io/mind-garden/`

---

## Step 5: Open Obsidian

1. Launch **Obsidian**
2. Click **"Open folder as vault"**
3. Select: `/Users/al/Websites/obsidian`
4. If prompted about "Safe mode", turn it **off** to enable plugins

The Obsidian Git plugin is already configured and will:
- Auto-commit every 5 minutes
- Auto-push to GitHub
- Pull updates on startup

---

## Step 6: Test It!

1. In Obsidian, create a new note (Cmd+N)
2. Write something:
   ```markdown
   # My First Note
   
   Hello world! This is my digital garden.
   ```
3. Save (Cmd+S)
4. Manually trigger sync:
   - Press **Cmd+P**
   - Type: **"Obsidian Git: Backup"**
   - Press Enter
5. Check GitHub - your note should appear!
6. Wait 2-3 minutes
7. Visit: `https://YOUR_USERNAME.github.io/mind-garden/`

**🎉 You should see your site live!**

---

## Step 7: Configure Your Domain (andrealabate.com/mind)

### Option A: Subdomain (Recommended)

**Add DNS Record:**
1. Go to your domain provider (where you bought andrealabate.com)
2. Add new DNS record:
   - Type: `CNAME`
   - Name: `mind`
   - Value: `YOUR_USERNAME.github.io`
   - TTL: Automatic or 3600

**Configure GitHub:**
1. Repository → Settings → Pages
2. Custom domain: `mind.andrealabate.com`
3. ✅ Enforce HTTPS (wait for DNS to propagate first - 5-60 minutes)

**Update Quartz config:**
Edit `quartz.config.ts`, change line 15:
```typescript
baseUrl: "mind.andrealabate.com",
```

Then commit and push:
```bash
git add quartz.config.ts
git commit -m "Update base URL"
git push
```

### Option B: Subdirectory (andrealabate.com/mind)

This requires server configuration. If your main site runs on:

**Apache (.htaccess):**
```apache
RewriteEngine On
RewriteRule ^mind/(.*)$ https://YOUR_USERNAME.github.io/mind-garden/$1 [P,L]
ProxyPreserveHost On
```

**Nginx (nginx.conf):**
```nginx
location /mind/ {
    proxy_pass https://YOUR_USERNAME.github.io/mind-garden/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

---

## ✅ What You Have Now

- 📝 **Obsidian vault** set up and ready
- 🔄 **Auto-sync** every 5 minutes
- 🌐 **Beautiful website** with graph view
- 🚀 **Auto-deployment** via GitHub Actions
- 🔗 **Wiki-style links** between notes
- 📊 **Knowledge graph** visualization
- 🎨 **Modern design** like Anthony Amar's site

---

## 📝 Daily Workflow

From now on, it's simple:

1. **Open Obsidian**
2. **Write your notes**
3. **That's it!** 

Everything syncs automatically every 5 minutes.

---

## 🎨 Customization

### Change Site Title/Colors
Edit: `quartz.config.ts`

### Change Layout
Edit: `quartz.layout.ts`

### Change Home Page
Edit: `index.md`

After any changes:
```bash
git add .
git commit -m "Customize site"
git push
```

---

## 📚 Learn More

- **Quartz Docs**: https://quartz.jzhao.xyz/
- **Obsidian Help**: https://help.obsidian.md/
- **Example Site**: https://anthonyamar.fr/Welcome+in+my+mind+🧠

---

## 🆘 Need Help?

Check these files:
- `QUICK_START.md` - Detailed walkthrough
- `GIT_SETUP.md` - Git authentication help
- `SETUP_GUIDE.md` - Complete documentation

---

## 🔒 Security Note

Your GitHub token is stored securely by macOS Keychain. It's never committed to your repository. If you ever need to revoke it, go to: https://github.com/settings/tokens

---

**Questions? Issues? Create an issue in your GitHub repository!**

**Happy gardening! 🌱**

