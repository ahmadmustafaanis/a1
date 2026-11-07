// Organ-specific "clay" colors so neighbouring organs read as distinct objects on a bright stage.
const BY_NAME: [RegExp, string][] = [
  [/^liver$/, '#B5524A'],
  [/gallbladder/, '#7FB069'],
  [/spleen/, '#8E5A9B'],
  [/stomach/, '#F08A8A'],
  [/pancreas/, '#F2C14E'],
  [/duodenum/, '#F4A261'],
  [/small_bowel/, '#F7B7A3'],
  [/colon/, '#E9D5B7'],
  [/esophagus/, '#E58F84'],
  [/kidney_cyst/, '#9AD1D4'],
  [/kidney/, '#C2554F'],
  [/adrenal/, '#F6D55C'],
  [/urinary_bladder/, '#F3DE8A'],
  [/prostate/, '#D68FB0'],
  [/heart|atrial/, '#D64550'],
  [/aorta|artery|brachiocephalic_trunk/, '#E63946'],
  [/portal_vein/, '#8E7DBE'],
  [/vena|vein/, '#4C6FD8'],
  [/lung/, '#A9CBEA'],
  [/trachea/, '#C9DDEE'],
  [/spinal_cord/, '#F4D58D'],
  [/costal_cartilages/, '#CFE3E8'],
  [/rib|vertebra|sacrum|hip|femur|humerus|scapula|clavicula|sternum|skull/, '#F1ECE2'],
  [/gluteus|autochthon|iliopsoas/, '#D9927F'],
  [/thyroid/, '#E9A8C2'],
  [/lesion/, '#FF3B30'],
]

export function organColor(name: string, fallback: string): string {
  for (const [re, c] of BY_NAME) if (re.test(name)) return c
  return fallback
}
