# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## Offline / Electron (use without internet)

The app can run fully offline using Electron and a local SQLite database:

1. **Install dependencies** (from project root): `npm i` and `cd server && npm i`
2. **Build the frontend**: `npm run build`
3. **Run Electron**: `npm run electron`

Electron will start the API server automatically with SQLite (data in your user data folder). The first run creates the database and a default user: **admin** / **admin123**. No MySQL or network required.

- Dev mode (loads Vite dev server): `ELECTRON_DEV=1 npm run electron` (run `npm run dev` in another terminal).
- Optional: for more sample data and role permissions with MySQL, run `cd server && npm run seed` and `npm run seed:roles-permissions`.

**Offline dev in the browser:** To use the app at `http://localhost:8080` without internet and log in as **admin** / **admin123**, run the API with SQLite: in one terminal run `npm run dev` (Vite), in another run `npm run dev:server` (API with SQLite and default admin). The normal `cd server && npm run dev` uses MySQL by default, which does not auto-create the admin user.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)
