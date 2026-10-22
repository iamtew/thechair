# The Chair

Using Three.JS and PixiJS to create a great visual 3D game in the browser. working great on both desktop and mobile.
First person view 3D experience.

The player, is in an apartment. it has entrance, where player spawns, he walks in, it has a living room. 
it has a kitchen, semi-open.
it has bathroom, toilet.
it has a bedroom, with a big bed. in the bedroom at the foot end a bit furhter down is a chair, a chesterfield chair.
next to the chesterfield chair is a little table. the table has a box on it, that can be opened.
inside the box is a note. a box of cigarettes, and an ashtray and a zippo-lighter.

the player can walk around the apartment and look at things.
in the bedroom, he can sit down in the chesterfield chair.
when he sits down, his view becomes from the view of sitting down.

Project to be hosted at github.
setup git repo in this folder.
setup github remote repo.
setup github pages to this repo.

update AGENTS.md accordingly.

## How it runs

Static page. Three.js draws the apartment. PixiJS draws the crosshair, the prompts, the note, and the touch controls. No build step. Modules come from jsDelivr, so the page needs a network.

- Local: `python -m http.server 5173`, then open the root.
- Live: https://iamtew.github.io/thechair/

## Controls

- Desktop: click to look, WASD to walk, E to sit, stand, open the box, or read the note. Esc releases the mouse. Hold the mouse button and drag if the browser will not capture the pointer.
- Phone: drag the left side to walk, the right side to look, tap Use.

Spawn is the entrance. The Chesterfield is in the bedroom, past the foot of the bed. The box on the side table opens. The note is inside, with cigarettes, an ashtray, and a Zippo.


