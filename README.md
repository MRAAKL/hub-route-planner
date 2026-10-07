# Hub Route Planner (prototype)

Static site: one `index.html`. No build step, no server, no environment variables.

## Deploy (dashboard, no command line)
1. Create a GitHub repository and upload these four files to its root.
2. In Vercel: Add New > Project > import the repository.
3. Framework Preset: Other. Build command: leave empty. Output directory: leave empty (root).
4. Deploy.
5. Project Settings > Deployment Protection: turn protection ON before sharing the link (see the note below).

## Deploy (command line)
    npm i -g vercel
    cd this-folder
    vercel login
    vercel --prod

## Before anyone outside you opens it
The GroupeSeb sample file and its orders have been removed. Users add their own Excel files from their folders.
The page still carries the GroupeSeb ship-to list (names and approximate locations) so that uploaded GroupeSeb files place correctly. A Vercel URL is public unless protected, so turn on Deployment Protection if your plan offers it.

## Known limits of this prototype
- No login, no shared data: each browser holds its own copy, nothing is saved on reload.
- Excel files are read inside the browser and are not uploaded anywhere.
- Excel reader (SheetJS) and fonts load from public CDNs.
