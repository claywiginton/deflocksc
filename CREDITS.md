# Credits & third-party notices

The **find-your-representative** tool on this site reuses open-source work.
Thank you to these projects.

## District boundaries & rosters — `open-civics` / `open-civics-boundaries`
The bundled files under `data/districts/` and `data/reps.json` are generated
(see `scripts/build-districts.mjs`) from the **open-civics** and
**open-civics-boundaries** npm packages.

MIT License — Copyright (c) 2026 Tim Simpson

## Point-in-polygon / district-matching approach — DeflockSC
The client-side matching logic in `rep-finder.js` is adapted from the
**DeflockSC** project (https://github.com/TimSimpsonJr/deflocksc-website).

MIT License — Copyright (c) 2026 Tim Simpson

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

## Camera counts & bill statuses — DeflockSC
`data/camera-counts.json` (ALPR cameras per SC county, originally from the
DeFlock crowdsourced map) and the SC bill statuses shown in the bill tracker
are adapted from the **DeflockSC** project
(https://github.com/TimSimpsonJr/deflocksc-website), MIT (c) 2026 Tim Simpson,
used with permission. Always verify bill status at scstatehouse.gov.

## Address geocoding — OpenStreetMap Nominatim
Address search uses the **Nominatim** service.
Geocoding © OpenStreetMap contributors, available under the ODbL.
https://www.openstreetmap.org/copyright
