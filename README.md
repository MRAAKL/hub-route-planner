# Hub Route Planner (prototype) with a shared Ship-to list

Files: `index.html` (the page), `api/shiptos.js` (the shared list), `vercel.json`, `robots.txt`.

## One-time setup of the shared list (about 10 minutes)
1. Put all files in the GitHub repository (keep the `api` folder as a folder).
2. In Vercel, open the project > **Storage** > create or connect an **Upstash Redis** database (free plan if offered) and connect it to this project. Vercel adds the connection settings by itself.
3. Project **Settings > Environment Variables**: add `ACCESS_CODE` with a code of your choice (at least 8 characters). Tick Production.
4. **Deployments > latest > Redeploy**, so the new settings take effect.
5. Open the page > **Ship-to list**, type your name and the access code, click **Connect**.
6. Click **Add the built-in GroupeSeb addresses** once, to put the starting list into the shared store.
7. Give each manager the page address and the access code.

## What this is, and is not
- One shared access code, not user logins. Anyone with the page address and the code can add, change or remove addresses.
- Every change records the name typed by the person who made it. Names are not checked.
- To stop someone using the code: change `ACCESS_CODE` in Vercel and redeploy, then tell the managers the new code.
- Real user logins and a proper database are for the developer to build.

## Loading the BP Master (ship-to addresses)

1. Open the page, go to **Ship-to list**, enter your name and the access code, press **Connect**.
2. Press **Import BP Master** and choose the GSS macro file (the sheet called "BP Master" is found automatically). The file is read in your browser; it is not uploaded anywhere except the shared list.
3. Read the report that appears (postal codes fixed, missing postal codes, dummy or duplicate codes).

Re-importing is safe: entries are matched by name and updated.
This update also changes `api/shiptos.js` (faster bulk saving), so upload **both** `index.html` and `api/shiptos.js` to GitHub.

## Update v11/v12: automatic locations and vehicle plan
Upload to the GitHub repository:
- `index.html` (replace) and `sg-postal.json` (new, repository root, about 6.6 MB; drag it into Add file > Upload files)
- `api/shiptos.js` (replace; keep the exact name and the `api` folder)
Then Vercel redeploys by itself. Open the page, Connect on the Ship-to list (real access code), then load the Excel again.

Locations come from a Singapore postal-code table. Contains information from OneMap, Singapore Land Authority (Open Data Licence). Stops matched only by road or building name are flagged "Approx. location".

v12 plans against the vehicles listed on the Approve routes page (default: 2 vans, 2 x 14 ft, 3 x 24 ft, 1 prime mover used only when nothing else fits), finishes deliveries by 17:00, plans the 24 ft up to 15 m³ (loads above 10 m³ are marked "tight fit"), and chains a second trip onto the same vehicle when it can be back, reloaded and still on time.

Morning loading: a first trip leaves 30 min after 08:00, or 90 min after 08:00 for a load over 10 m³ (several vehicles can load at the same time). A second trip needs 20 min back at the warehouse. These are constants (MORN_SMALL, MORN_BIG, LOAD_MIN) in index.html.

Timing used: warehouse to first customer 45 to 90 min (by distance, same for the way back); 30 to 60 min per stop for unloading and sign-off (30 min plus 3 min per m³, at most 60); between customers 2.7 min per km. Constants: legMin and serviceMin in index.html.

Lunch: every driver gets a 1 hour break once the day passes 12:00 (after the stop in progress, or at the warehouse between two trips). Constants LUNCH_AT and LUNCH_MIN in index.html.
