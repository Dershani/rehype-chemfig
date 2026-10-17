export const examples = [
  {
    name: 'Aspirin',
    source: '*6(-=-(-O-[::-60](=[::-60]O)-[::+60])=(-(=[::+60]O)-[::-60]OH)-=)',
    note: 'An aromatic scaffold with two branched functional groups.',
  },
  {
    name: 'Caffeine',
    source: '*6((=O)-N(-CH_3)-*5(-N=-N(-CH_3)-=)--(=O)-N(-H_3C)-)',
    note: 'Nested rings, heteroatoms, and methyl groups in one drawing.',
  },
  {
    name: 'Lactic acid',
    source: 'H_3C-[:30](<[:90]OH)(<:[:-90]H)-[:-30]C(=[:30]O)-[:-30]OH',
    note: 'Solid and hashed wedges preserve the direction written in the source.',
  },
  {
    name: 'Phenol',
    source: '**6(---(-OH)---)',
    note: 'A complete six-membered ring with an aromatic circle.',
  },
  {
    name: 'Acetate',
    source: 'H_3C-C(=[:90]O)-O^{-}',
    note: 'Explicit subscripts, a carbonyl branch, and a superscript charge.',
  },
  {
    name: 'Benzene',
    source: '*6(-=-=-=)',
    note: 'A skeletal ring with alternating double bonds drawn on the inside.',
  },
  {
    name: 'Ethanol',
    source: 'H_3C-[:30]CH_2-[:-30]OH',
    note: 'A short chain with explicit hydrogen labels and alternating bond angles.',
  },
  {
    name: 'Glycine',
    source: 'H_2N-[:30]CH_2-[:-30]C(=[:-90]O)-[:30]OH',
    note: 'An amino acid drawn with an amine, a methylene group, and a carboxyl group.',
  },
  {
    name: 'Acetonitrile',
    source: 'H_3C-C~N',
    note: 'Chemfig uses a tilde for a triple bond, not a hash.',
  },
  {
    name: 'Pyridine',
    source: '*6(-N=-=-=)',
    note: 'A six-membered aromatic ring with an explicitly labeled nitrogen.',
  },
] as const;
