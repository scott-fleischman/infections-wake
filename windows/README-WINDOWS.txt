===================================================================
 INFECTION'S WAKE  -  Windows 10
===================================================================

HOW TO PLAY
-----------
1. Keep every file in this folder together (do not move
   "Play-InfectionsWake.bat" away from the "game" folder).
2. Double-click:   Play-InfectionsWake.bat
3. A small black window opens and your default browser launches the
   game at http://localhost:8137/
4. Play. When you are done, close the black window to stop the game.

That is all. Nothing needs to be installed.


WHY A LOCAL SERVER?
-------------------
Infection's Wake is a browser game built with modern web modules.
Modern browsers block those modules when a page is opened directly
from disk (file://...), so the game will NOT run by double-clicking
the .html file. The launcher runs a tiny local web server on your own
machine so the browser can load it normally. Nothing is uploaded and
no internet connection is required.


IF THE BROWSER DOES NOT OPEN AUTOMATICALLY
------------------------------------------
Leave the black window open and browse to:
   http://localhost:8137/

Extra pages (optional):
   http://localhost:8137/gallery.html   - model archive
   http://localhost:8137/docs.html      - field manual / design docs


CONTROLS (quick reference)
--------------------------
   WASD / mouse    move / look (click the page to capture the mouse)
   Space / Shift   jump / sprint
   LMB (hold)      break block / attack
   RMB             place block / use item
   1-6, Q          hotbar
   E               field kit (inventory + crafting)
   F               interact (doors, machines, valves, radio...)
   J               story log & bestiary
   M               valley map
   Esc             pause (accessibility options live here)


TROUBLESHOOTING
---------------
* "Port 8137 is already in use"
     Something else is using that port. Open a Command Prompt in this
     folder and run:   set PORT=9000 & Play-InfectionsWake.bat
     then browse to http://localhost:9000/

* PowerShell says it is blocked by policy
     The launcher already passes -ExecutionPolicy Bypass, so this is
     rare. If it still happens, install Node.js (https://nodejs.org)
     and re-run the launcher - it will use Node automatically.

* Your progress is saved automatically inside the browser you play in
  (per browser, on this machine). Playing in a different browser
  starts a fresh valley.


REQUIREMENTS
------------
* Windows 10
* Any up-to-date browser with WebGL: Edge, Chrome, or Firefox
  (Edge is already installed on Windows 10).
* Node.js is OPTIONAL. If it is installed the launcher uses it;
  if not, it uses the PowerShell server that ships with Windows.
===================================================================
