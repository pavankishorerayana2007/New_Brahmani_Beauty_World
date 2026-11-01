# GitHub guide

1. https://github.com → **New repository** → name it (e.g. `brahmani-beauty-world`) → **Private** recommended → *do not* add README/.gitignore → Create.
2. Make sure `.env` is NOT going to be uploaded: `.gitignore` already excludes `.env` and `node_modules`. Check with `git status` after `git add .` — `.env` must not be listed.
3. In the VS Code terminal (project folder):
```
git init
git add .
git commit -m "Initial full-stack implementation"
git branch -M main
git remote add origin YOUR_GITHUB_REPOSITORY_URL
git push -u origin main
```
(First time you may need `git config --global user.name "Your Name"` and `git config --global user.email "you@example.com"`. GitHub asks you to sign in in a browser.)

## Later changes
```
git add .
git commit -m "Describe what you changed"
git push
```
If a secret was ever committed by mistake: rotate it (Supabase → reset keys/password, new `JWT_SECRET`) — deleting the file is not enough.
