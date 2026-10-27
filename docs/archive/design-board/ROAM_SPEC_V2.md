# The companion lives on the screen — V2 (founder clarification, 2026-09-19)

The founder corrected the first version: **"live" does not mean moving around all the time.** It means: as the member navigates, on each screen their companion has **naturally appeared at a different, random place, clinging to the UI, and it stays there.** No clock, no wandering. And it is **the member's own chosen companion** (any of the nine animals), never a fixed cat.

## Rules (these replace ROAM_SPEC.md's "How it chooses")
1. Every screen declares its perches (rect + type + allowed poses). A perch is eligible only if the companion's box there covers no text and no tap target.
2. **On every arrival at a screen** (navigate in, switch tab, come back, a sheet opens) one eligible perch is picked at seeded random — never the one used on the previous visit to that screen, and weighted by the animal's personality. The companion is **already there** when the screen arrives (it arrives with the screen's own arrival, no separate show, no walking in).
3. **It stays.** It breathes (the existing 5.2 s idle), nothing else. No timer moves it.
4. Small reactions happen **in place** and are optional garnish: tap it → one greet; save a note → one small joy; then back to its perch pose. No travel.
5. Pose follows perch: `top` = sit (idle) · `dangle` = legs over the edge · `hang` = under an edge by the paws · `peek` = head and paws over an edge · `lean` = curious against a side · `nap` = asleep along an edge (only late at night or after a long quiet spell). An animal that lacks the art for a perch type simply never gets that perch — it is a data table per animal, so new art widens its range with no code change.
6. **Still states unchanged**: crisis card, errors, message limit, Start fresh → home perch, comfort/sit pose, no randomness. Reduced motion → same random placement is fine (placement is not motion) but no breathing and no reactions. Quiet Pause / Away Mask → hidden.
7. Personality = perch weights per animal (Cat edges and dangles · Panda hangs · Fox peeks · Dog sits low and close · Capybara naps near the tab bar · Owl high perches · Deer top edges · Turtle lowest · Elephant peeks).

## Art available on the board today
Cat (full range): idle `/_blob/1efb69b914df0befa72042da746fa6a7` · greet `/_blob/c5932cbe7933051e63ca71be87e0d6f1` · joy `/_blob/4f2efcf71291b5c16ffd4f80ab2a3e70` · comfort `/_blob/5ef7c66e2ec3a36385bafc98e11b92ed` · curious `/_blob/ca61e83f28c39e94950642c2a809833d` · sleepy `/_blob/0679b2d38a2ca46e70a0baf08fd6219b` · hang `/_blob/71fc89b7009da3701d2bceb080e0f24e` (paws at the very top, 429×1024) · peek `/_blob/67d36538c4a7c1dbe0fbf0629cc04e87` (head + paws, bottom edge = paw line, 1024×981) · dangle `/_blob/f5d6206e0be74fe6dc95f9b0722f5877` (seat line at 0.84 of height, 802×1024) · stretch `/_blob/2f7fa3f0f011fb995fad415d54fc8473` · walk / climb exist but are no longer needed.
Other animals — idle / curious / sleepy only (so: `top`, `lean`, `nap` perches; greet from `A03_Companion.dc.html`):
- Panda `/_blob/43230048b776f2ff94d33e0fa140d725` · `/_blob/440c6a8d0915ce44b50b4320b43d1870` · `/_blob/25b657f793c4ff0c7b6ee92b168a958d`
- Dog `/_blob/0c005c3ccd4f52c8cdec64fcdb969a5c` · `/_blob/23230004e1558de35b1d9385a5451727` · `/_blob/9ff9a8509490d76d65f3129e3dd5dbc0`
- Fox `/_blob/265423dc8215648a9bf970aaa634e596` · `/_blob/d87755b53509e7a1489ee69e3d25ee96` · `/_blob/3c5b374271ee54c928980ec829f10458`
- Capybara `/_blob/e24b931d92e34394ed5c239860bd3954` · `/_blob/327d2e7a0276e447bebd8f35e85581f9` · `/_blob/3078708d08a58ec5ab0262db717e9545`
- Elephant `/_blob/b269db7c95235bfef40a235c56db9070` · `/_blob/2b7bb90ac5b9c62e27121bc072cef2fe` · `/_blob/7906a938e2887e3f711508b837f30e1a`
- Turtle `/_blob/c1d23c5473dbb02c8c74f310e63be723` · `/_blob/d2a863e9fea19b565f07c354438ad1dc` · `/_blob/9467ae9a4bca8e8849cfe0a29f2e6f8e`
- Deer `/_blob/c1b1a6dc110d1df028f772f5aa0f6c94` · `/_blob/fa60f5b0ae449145b3c9cce92a101eb2` · `/_blob/07e8e2cbed2216dbf0893e401df6ae07`
- Owl `/_blob/fef8c8099890805ca9a9c6e6e302488e` · `/_blob/eddca3a5f62ea78a93ab0da4211ae089` · `/_blob/0fb56d4ddf19c188971760fbea530641`
