# References and attributions

Every external resource used by this project — data, software, documents — is listed
here with its source, licence or usage terms, and where it is used. The list is updated
when a resource is added, not reconstructed at the end.

## NASA data and resources

| Resource | Source | Terms | Used for |
|---|---|---|---|
| JPL Horizons System (ephemeris DE441, lunar frame MEAN_ME) | https://ssd.jpl.nasa.gov/horizons/ — API https://ssd-api.jpl.nasa.gov/doc/horizons.html | NASA/JPL public data service | Reference Sun and Earth azimuth/elevation for nine lunar sites and five time windows (`data/horizons/fixtures.json`, fetched by `tools/horizons/fetch_fixtures.py`); the engine is tested against these 9,810 reference values (nine sites, five time windows between 2026 and 2035) |
| LOLA elevation model `LDEM_75S_120M` (Lunar Reconnaissance Orbiter, data set LRO-L-LOLA-4-GDR-V1.0) | NASA Planetary Data System Geosciences Node — https://pds-geosciences.wustl.edu/missions/lro/lola.htm ; exact file and checksum in `data/terrain/README.md` | NASA PDS public archive | Terrain skyline at every site, the 480 m model shipped with the app, the shaded-relief map |
| Lunar Artifacts and Impact Sites table | NASA Space Science Data Coordinated Archive — https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_artifact_impacts.html | NASA public information | Apollo landing coordinates (`data/sites/catalog.json`) |
| LROC featured-image posts (Lunar Reconnaissance Orbiter Camera, NASA/GSFC/Arizona State University) | https://www.lroc.asu.edu/images — exact post per site in `data/sites/catalog.json` | Public web pages; coordinates cited as facts | Measured coordinates of robotic landers |
| LOLA-team average illumination maps `AVGVISIB_85S_060M_201608` (Sun) and `AVGVISIB_85S_060M_201608_EARTH` (Earth), 60 m, south of 85 S | NASA Planetary Data System Geosciences Node — https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/extras/illumination/ ; checksums in `data/terrain/README.md` | NASA PDS public archive (extras) | Independent check of this project's terrain and ephemeris chain (`tools/validation/illumination.ts`, `docs/validation-illumination.json`); long-term averages shown per site; the eight best-lit candidate points; map layers |

## Space Agency Partner data and resources

| Resource | Source | Terms | Used for |
|---|---|---|---|
| *(entries are added as each resource is actually used)* | | | |

## Software

| Component | Source | Licence | Used for |
|---|---|---|---|
| Node.js | https://nodejs.org/ | MIT and others (see upstream) | Build and test runtime |
| Vite | https://vite.dev/ | MIT | Development server and production build |
| TypeScript | https://www.typescriptlang.org/ | Apache-2.0 | Type checking |
| Preact 11 and @preact/signals | https://preactjs.com/ | MIT | User interface |
| tsx | https://tsx.is/ | MIT | Runs the build scripts |
| Vitest | https://vitest.dev/ | MIT | Automated tests |
| Astronomy Engine 2.1.19 (Don Cross) | https://github.com/cosinekitty/astronomy | MIT | Geocentric Sun and Moon vectors inside the computational core; validated against NASA/JPL Horizons |

## Documents

| Document | Source | Used for |
|---|---|---|
| Lunar Landing Site Navigator challenge statement | https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/ | Requirements |
| Gazetteer of Planetary Nomenclature (IAU / USGS Astrogeology) | https://planetarynames.wr.usgs.gov/ | Names and centre coordinates of south-polar features (`data/sites/catalog.json`) |
| Mazarico, E., G.A. Neumann, D.E. Smith, M.T. Zuber and M.H. Torrence, Illumination conditions of the lunar polar regions using LOLA topography, Icarus 211(2), 1066-1081 | doi:10.1016/j.icarus.2010.10.030 | Method behind the NASA illumination maps used for validation |
| NASA, *Lunar Site Selection* (Moon to Mars Architecture white paper), NTRS 20230016267 | https://ntrs.nasa.gov/api/citations/20230016267/downloads/Lunar%20Site%20Selection.pdf | Quoted in the README: "the Earth must be visible in the lunar sky from the landing site"; "no single location constantly — or even routinely — has ideal lighting and Earth visibility conditions" |
| NASA, *Artemis Human Landing System Overview — NASA 2025 International Space Apps Challenge* (4 October 2025), NTRS 20250009323 | https://ntrs.nasa.gov/api/citations/20250009323/downloads/ArtemisOverview2025IntSPAPPSChallenge.pdf | Quoted in the README: "Sun and Earth only rise above the horizon ~2 to 7 deg" |
| M. Sanchez Net, *Dynamics of a Coherent Reflection on Direct-with-Earth Links between a Planetary Body and an Earth Station*, IPN Progress Report 42-240, Jet Propulsion Laboratory, 15 February 2025 | https://ipnpr.jpl.nasa.gov/progress_report/42-240/42-240A.pdf | Earth elevations reported for the IM-1 and Chandrayaan-3 landings, used as a check (`tests/engine/missions.test.ts`); the terrain-mask picture and the fading of grazing radio links mentioned in the README and methodology |
| Apache License 2.0 text | https://www.apache.org/licenses/LICENSE-2.0.txt | `LICENSE` file |
