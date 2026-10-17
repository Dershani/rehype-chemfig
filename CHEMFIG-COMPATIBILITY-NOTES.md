# Independent compatibility research

Reference: Chemfig v1.82 official manual https://mirrors.ctan.org/macros/generic/chemfig/chemfig-en.pdf and implementation https://mirrors.ctan.org/macros/generic/chemfig/chemfig.tex . These are implementation/review notes, not claims about this package's supported features.

- `[n]` is absolute n×45°, `[:d]` absolute degrees, `[::d]` relative to preceding bond. Omitted angle uses scoped default, not previous angle. Positive angles are counterclockwise. Leading `[:20,1.5]` sets molecule/branch defaults; individual overrides do not mutate defaults.
- Branches restore attachment, incoming angle, and defaults. Sibling relative angles reference the original incoming bond. Branch-local leading defaults remain local.
- Rings reuse the attachment vertex and closing bond. Do not invent closing bonds for incomplete rings. Standalone ring first direction is −90+360/n degrees; attached ring after incoming θ starts θ−90+180/n. Initial defaults rotate standalone rings. Ring-side angle/length overrides are ignored by upstream. Ring branches point outward along the vertex bisector.
- `**6(------)` draws six explicit single sides plus inner circle. `**[30,330]5(-----)` uses a 300-degree inner arc. Ring doubles offset inward; outside rings doubles are centered. `=^`/`=_` select left/right secondary line.
- Preserve balanced braces in labels: `N^{-}` has no bond, `{(CH_3)_3}` has no structural branch. Group attachment fields are 1-based subatom indices, not graph vertex indices.
- Wedges: `A>B` wide at A, narrow at B; `A<B` narrow at A, wide at B. Hashed `>:`/`<:` and hollow `>|`/`<|` preserve directions. Match longest tokens first.
- Distinguish outer `\\chemfig[atom sep=...,angle increment=...]{...}`, leading body defaults, and per-bond `[angle,length,from,to,style...]`. Empty fields matter; fifth field includes remaining style commas. Diagnose unsupported TeX/TikZ features explicitly.
- Markdown raw prose may consume Chemfig punctuation before AST transforms. Fences and explicit inline-code conventions preserve it; raw prose needs tokenizer extension. Emit real HAST SVG.

## Canonical fixtures (mathematical angles)

1. `A-[1]B-C-[::30]D`: angles 45,0,30.
2. `[:20,1.5]A-B-[:-80,0.7]C-D`: angles 20,-80,20; lengths 1.5,.7,1.5.
3. `A-[:30]B(-[::60]C)(-[::-60]D)-[::0]E`: branch angles 90,-30 and continuation 30; B degree four.
4. `A-B([:60]-C-D)-E`: branch angles both 60, continuation 0.
5. `*6(-=-=-=)`: six vertices/edges, three doubles; angles -30,30,90,150,210,270; inner doubles.
6. `[:30]*6(------)`: rotated +30 degrees; first side 0, last 300.
7. `A-[:25]B*4(----)`: five vertices/edges, square shares B; first square side -20; center direction 25.
8. `**6(------)` and `**[30,330]5(-----)`: inner circle and 300-degree arc, no extra vertices or doubles.
9. `H_3C-C(=[:90]O)-O^{-}`: four label groups, carbonyl upward, correctly rendered sub/superscripts.
10. `A>B`, `A<B`, `A>:B`, `A<:B`, `A>|B`, `A<|B`: verify wedge direction at arbitrary angles.

Additional upstream semantics: `*5(---)` is open; `*6(-(-OH)-----)` has outward OH; `ABCD-[:75,,2,3]EFG` connects B to G; `-[,,,,draw=none]` advances without drawing.
