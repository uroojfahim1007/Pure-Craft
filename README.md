# PURE & CRAFT: Vercel deployment
1. Upload this whole folder to a new GitHub repository (or run `npx vercel` inside it).
2. Vercel > Add New > Project > import the repository. Leave all build settings empty. Deploy.
3. Vercel project > Storage > Create > Upstash Redis (free plan) > Connect to this project.
4. Project > Settings > Environment Variables: add ADMIN_PASSWORD (your admin password). Optional: AUTH_SECRET.
5. Deployments > Redeploy.
6. Open https://YOUR-PROJECT.vercel.app/#/admin, sign in, edit anything once and press Save to store your catalogue.
