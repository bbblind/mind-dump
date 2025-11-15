---
title: How to Use Your Digital Garden
date: 2025-11-15
---

# 📝 How to Use Your Digital Garden

## ✅ Quick Start

**All your notes go in the `content/` folder!**

This is your working area in Obsidian. Everything else is configuration files.

---

## 📁 Folder Structure

```
/Users/al/Websites/obsidian/
├── content/              ← YOUR NOTES GO HERE! Work in this folder!
│   ├── index.md         ← Your homepage  
│   ├── Example Notes/   ← Example folder
│   └── [Your notes here]
│
├── quartz/              ← Site generator (don't touch)
├── node_modules/        ← Dependencies (don't touch)
├── .obsidian/           ← Obsidian settings
└── [Setup docs]         ← Documentation (won't appear on site)
```

---

## ✍️ Creating Notes

### In Obsidian:

1. **Navigate to the `content/` folder** in the left sidebar
2. **Right-click → New note** or **New folder**
3. **Write your content** in Markdown
4. **Save** (Cmd+S)

### Example Structure:

```
content/
├── index.md (home page)
├── Projects/
│   ├── Project 1.md
│   └── Project 2.md
├── Ideas/
│   ├── Idea A.md
│   └── Idea B.md
└── Learning/
    ├── Programming/
    │   └── Python Notes.md
    └── Design/
        └── UX Principles.md
```

---

## 🔗 Linking Notes

Use WikiLinks to connect notes:

```markdown
Check out my [[Project 1]] for details.

See also: [[Ideas/Idea A]]
```

---

## 🏷️ Adding Tags

Add tags in the frontmatter:

```markdown
---
title: My Note
tags:
  - programming
  - python
  - tutorial
---

# Content here...
```

---

## 🔄 Auto-Sync to GitHub

Your changes sync automatically every 5 minutes!

Or manually:
- **Cmd+P** → type "Obsidian Git: Backup" → Enter

You'll see notifications:
- "Committing..." 
- "Pushing..."
- "Pushed successfully!"

---

## 🌐 Your Published Site

- **URL**: https://bbblind.github.io/mind-dump/
- **Updates**: 2-3 minutes after sync
- **Check build**: https://github.com/bbblind/mind-dump/actions

---

## 📊 Features

- **Graph View**: Click the graph icon to see connections
- **Search**: Cmd+O to search notes
- **Links**: [[Link]] to other notes
- **Backlinks**: See what links to current note
- **Tags**: Organize with #tags

---

## 🎨 Customizing

### Change Site Title/Colors:
Edit: `/quartz.config.ts`

### Change Homepage:
Edit: `/content/index.md`

### After changes:
The Git plugin will auto-sync!

---

## ⚠️ Important Rules

1. **All notes must be in `content/` folder**
2. **Don't edit files in `quartz/`, `node_modules/`, or `public/`**
3. **Setup docs in root won't appear on your site** (they're ignored)
4. **Wait 2-3 min after sync for site to update**

---

## 🆘 Troubleshooting

### Not syncing?
- Check bottom status bar: "Changes: X"
- Manually trigger: Cmd+P → "Obsidian Git: Backup"
- Check Settings → Community plugins → Git is enabled

### Site not updating?
- Check: https://github.com/bbblind/mind-dump/actions
- Look for errors in the workflow
- Builds take 2-3 minutes

### Can't see my note on the site?
- Make sure it's in the `content/` folder
- Check it's not in a `private/` or `drafts/` folder
- Wait for the build to complete

---

## 🌱 Example Workflow

1. Open Obsidian → Navigate to `content/`
2. Create new note: "My First Real Note"
3. Write content with [[links]] and #tags
4. Save (Cmd+S)
5. Wait 5 minutes (or manual backup)
6. Check GitHub Actions for build
7. Visit https://bbblind.github.io/mind-dump/

---

**Happy gardening! 🌱**

