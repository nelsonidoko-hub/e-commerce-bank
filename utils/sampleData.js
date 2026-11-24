// Starter content for a new shop, matched to the template it starts from, so
// it never opens empty. Everything is marked isSample and can be removed in
// one click (Admin → Dashboard → Remove sample products).
//
// Pictures are small generated SVGs (a soft colour panel with the product's
// name), so no outside images and nobody else's photos.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// A small drawing (emoji) for each kind of product, so a sample picture shows
// what the thing is, not just its name. First match wins. Kept in step with
// frontend utils/pictureIcons.js.
export const PICTURE_ICONS = [
  [/backpack|school bag/i, '🎒'],
  [/sneaker|shoe|slides|sandal/i, '👟'],
  [/sun hat|straw hat/i, '👒'],
  [/cap\b|hat\b/i, '🧢'],
  [/dress|gown/i, '👗'],
  [/hoodie|jacket|coat/i, '🧥'],
  [/trouser|pants|jeans|shorts/i, '👖'],
  [/scarf/i, '🧣'],
  [/tee\b|t-shirt|shirt|top\b/i, '👕'],
  [/tote|clutch|bag|purse/i, '👜'],
  [/belt|tie\b/i, '👔'],
  [/romper|baby wear/i, '👶'],
  [/feeding|bottle set|baby/i, '🍼'],
  [/teddy|plush|toy/i, '🧸'],
  [/blocks|lego/i, '🧱'],
  [/crayon|art kit|paint/i, '🖍️'],
  [/jollof|fried rice|ofada|rice/i, '🍛'],
  [/small chops|platter|suya/i, '🍢'],
  [/soup|stew/i, '🍲'],
  [/cake|pastry|bread/i, '🍰'],
  [/zobo|chapman|juice|drink|smoothie/i, '🍹'],
  [/water bottle|flask/i, '🥤'],
  [/frying pan|pan\b|pot\b/i, '🍳'],
  [/kettle|tea/i, '☕'],
  [/blender/i, '🥤'],
  [/fan\b/i, '🌀'],
  [/bulb|lamp|light/i, '💡'],
  [/towel/i, '🛁'],
  [/storage|container/i, '🥡'],
  [/extension|socket|charger|cable/i, '🔌'],
  [/clock/i, '🕰️'],
  [/lip|lipstick|gloss/i, '💄'],
  [/mist|perfume|fragrance/i, '🌸'],
  [/lotion|cream|serum|butter|soap|oil|cleanser/i, '🧴'],
  [/earbud|headphone|earphone/i, '🎧'],
  [/speaker/i, '🔊'],
  [/power bank|battery/i, '🔋'],
  [/watch/i, '⌚'],
  [/phone|case/i, '📱'],
  [/laptop|computer/i, '💻'],
  [/book/i, '📚'],
  [/plant|flower/i, '🪴'],
  [/new arrivals|collection|sale/i, '🛍️'],
]
export const pictureIcon = (label) => PICTURE_ICONS.find(([re]) => re.test(String(label)))?.[1] || '🛍️'

// A picture: soft gradient in the given colours, a drawing of the product,
// and its name underneath
export function samplePicture(label, from = '#e5e7eb', to = '#9ca3af', { width = 600, height = 800 } = {}) {
  const words = String(label).split(' ')
  const lines = []
  for (const w of words) {
    const last = lines[lines.length - 1]
    if (last && (last + ' ' + w).length <= 14) lines[lines.length - 1] = `${last} ${w}`
    else lines.push(w)
  }
  const size = Math.round(Math.min(width, height * 0.9) / 11)
  const icon = Math.round(Math.min(width, height) * 0.38)
  const iconY = height * 0.42
  const startY = iconY + icon * 0.72
  const text = lines
    .slice(0, 2)
    .map((l, i) => `<text x="50%" y="${startY + i * size * 1.2}" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="${size}" font-weight="700" fill="#ffffff" fill-opacity="0.92">${esc(l)}</text>`)
    .join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="50%" cy="${iconY}" r="${icon * 0.62}" fill="#ffffff" fill-opacity="0.22"/><text x="50%" y="${iconY}" text-anchor="middle" dominant-baseline="central" font-size="${icon}">${pictureIcon(label)}</text>${text}<text x="50%" y="${height - size * 0.8}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${Math.round(size * 0.45)}" fill="#ffffff" fill-opacity="0.75">SAMPLE</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

const one = (stock = 20) => [{ size: 'One size', stock }]
const sml = (stock = 8) => ['S', 'M', 'L'].map((size) => ({ size, stock }))
const plates = (stock = 30) => [{ size: 'Regular', stock }, { size: 'Large', stock }]

// colours: [from, to] for pictures; categories: [name, label]
const SETS = {
  classic: {
    colours: ['#93c5fd', '#1d4ed8'],
    categories: [['clothing', 'Clothing'], ['accessories', 'Accessories']],
    row: 'accessories',
    products: [
      ['Classic Cotton Tee', 8500, 'clothing', sml(), 'Soft everyday tee in breathable cotton.'],
      ['Canvas Tote Bag', 6500, 'accessories', one(), 'Roomy tote for work, market and everything between.'],
      ['Leather Belt', 7000, 'accessories', one(), 'Full-grain leather with a brushed buckle.'],
      ['Denim Jacket', 22000, 'clothing', sml(5), 'A wardrobe staple that gets better with wear.', { bestSeller: true }],
      ['Steel Water Bottle', 5500, 'accessories', one(), 'Keeps drinks cold for 24 hours.'],
      ['Linen Shorts', 9500, 'clothing', sml(), 'Light and easy for hot afternoons.'],
    ],
  },
  minimal: {
    colours: ['#e7e0d3', '#8b7d6b'],
    categories: [['women', 'Women'], ['accessories', 'Accessories']],
    row: 'women',
    products: [
      ['Linen Wrap Dress', 28000, 'women', sml(), 'Relaxed linen dress with a tie waist.', { bestSeller: true }],
      ['Silk Scarf', 12000, 'accessories', one(), 'Lightweight silk in a muted print.'],
      ['Wide-Leg Trousers', 21000, 'women', sml(), 'Tailored drape, comfortable all day.'],
      ['Straw Sun Hat', 9000, 'accessories', one(), 'Handwoven straw with a wide brim.'],
      ['Cotton Shirt Dress', 24000, 'women', sml(), 'Crisp cotton, easy to dress up or down.'],
      ['Woven Clutch', 15000, 'accessories', one(), 'A small bag for big evenings.'],
    ],
  },
  bold: {
    colours: ['#f87171', '#111111'],
    categories: [['streetwear', 'Streetwear'], ['sneakers', 'Sneakers']],
    row: 'sneakers',
    products: [
      ['Graphic Hoodie', 25000, 'streetwear', sml(), 'Heavyweight fleece, oversized fit.', { bestSeller: true }],
      ['Cargo Pants', 23000, 'streetwear', sml(), 'Six pockets, tapered leg.'],
      ['High-Top Sneakers', 42000, 'sneakers', ['40', '41', '42', '43', '44'].map((size) => ({ size, stock: 4 })), 'Chunky sole, all-day grip.'],
      ['Snapback Cap', 8000, 'streetwear', one(), 'Flat brim, embroidered logo.'],
      ['Runner Sneakers', 38000, 'sneakers', ['40', '41', '42', '43'].map((size) => ({ size, stock: 4 })), 'Light runners for the city.'],
      ['Boxy Tee', 11000, 'streetwear', sml(), 'Dropped shoulders, thick cotton.'],
    ],
  },
  fresh: {
    colours: ['#fdba74', '#c2410c'],
    categories: [['meals', 'Meals'], ['drinks', 'Drinks'], ['small-chops', 'Small Chops']],
    row: 'meals',
    products: [
      ['Party Jollof Rice', 3500, 'meals', plates(), 'Smoky jollof with fried plantain and chicken.', { bestSeller: true }],
      ['Fried Rice Special', 3500, 'meals', plates(), 'With mixed vegetables, liver and prawns.'],
      ['Small Chops Platter', 6000, 'small-chops', one(30), 'Puff-puff, samosa, spring rolls and gizzard.'],
      ['Ofada Rice & Sauce', 4000, 'meals', plates(), 'Local rice with spicy ayamase sauce.'],
      ['Chilled Zobo', 1000, 'drinks', one(50), 'Hibiscus drink with ginger and pineapple.'],
      ['Fresh Chapman', 1500, 'drinks', one(50), 'The classic Nigerian party drink.'],
    ],
  },
  catalog: {
    colours: ['#6ee7b7', '#047857'],
    categories: [['home', 'Home'], ['kitchen', 'Kitchen'], ['electronics', 'Electronics'], ['personal-care', 'Personal Care']],
    row: 'kitchen',
    products: [
      ['Non-Stick Frying Pan', 12500, 'kitchen', one(), '28 cm, works on gas and electric.', { bestSeller: true }],
      ['Electric Kettle 1.7L', 15000, 'kitchen', one(), 'Boils in under 4 minutes.'],
      ['Rechargeable Fan', 28000, 'electronics', one(), 'Up to 8 hours on one charge.'],
      ['LED Bulb Pack of 4', 4500, 'home', one(), 'Warm white, low power.'],
      ['Bath Towel Set', 11000, 'home', one(), 'Two bath and two hand towels.'],
      ['Food Storage Set', 9000, 'kitchen', one(), '10 airtight containers.'],
      ['Extension Box', 7500, 'electronics', one(), '6 sockets with surge protection.'],
      ['Body Lotion 400ml', 3500, 'personal-care', one(), 'Daily moisture with shea butter.'],
      ['Wall Clock', 6000, 'home', one(), 'Silent sweep movement.'],
      ['Blender 1.5L', 26000, 'kitchen', one(), 'Two speeds plus pulse.'],
    ],
  },
  glow: {
    colours: ['#fbcfe8', '#be185d'],
    categories: [['skincare', 'Skincare'], ['body', 'Body'], ['fragrance', 'Fragrance']],
    row: 'skincare',
    products: [
      ['Vitamin C Serum', 14000, 'skincare', one(), 'Brightening serum for an even glow.', { bestSeller: true }],
      ['Raw Shea Butter', 4500, 'body', one(), 'Pure unrefined shea from the north.'],
      ['Hydrating Face Cream', 12000, 'skincare', one(), 'Light, non-greasy, all skin types.'],
      ['Body Mist', 9000, 'fragrance', one(), 'Soft floral scent that lasts.'],
      ['Black Soap Cleanser', 5000, 'skincare', one(), 'Gentle African black soap face wash.'],
      ['Tinted Lip Oil', 6000, 'body', one(), 'Glossy colour that nourishes.'],
    ],
  },
  tech: {
    colours: ['#67e8f9', '#0e7490'],
    categories: [['phones', 'Phones'], ['audio', 'Audio'], ['accessories', 'Accessories']],
    row: 'accessories',
    products: [
      ['Wireless Earbuds', 25000, 'audio', one(), 'Noise reduction and 24-hour case.', { bestSeller: true }],
      ['Power Bank 20000mAh', 18000, 'accessories', one(), 'Charges two phones at once.'],
      ['Fast Charger 25W', 9000, 'accessories', one(), 'USB-C fast charging.'],
      ['Bluetooth Speaker', 32000, 'audio', one(), 'Waterproof, 12 hours of play.'],
      ['Smart Watch', 45000, 'accessories', one(), 'Heart rate, steps and notifications.'],
      ['Phone Case', 5000, 'phones', one(), 'Shockproof edges, slim fit.'],
    ],
  },
  playful: {
    colours: ['#c4b5fd', '#7c3aed'],
    categories: [['baby', 'Baby'], ['toys', 'Toys'], ['school', 'School']],
    row: 'toys',
    products: [
      ['Baby Romper', 7500, 'baby', ['0-3m', '3-6m', '6-12m'].map((size) => ({ size, stock: 6 })), 'Soft cotton with easy snaps.', { bestSeller: true }],
      ['Plush Teddy Bear', 9000, 'toys', one(), 'Extra soft and safe for all ages.'],
      ['Building Blocks Set', 15000, 'toys', one(), '120 colourful pieces.'],
      ['Kids School Backpack', 12000, 'school', one(), 'Padded straps, bottle pocket.'],
      ['Baby Feeding Set', 6500, 'baby', one(), 'Bowl, spoon and cup, BPA free.'],
      ['Crayon Art Kit', 5500, 'school', one(), '48 crayons and a sketch pad.'],
    ],
  },
}

export const SAMPLE_TEMPLATES = Object.keys(SETS)
// The sample product names in each set (the Template Studio gives each a photo slot)
export const SAMPLE_PRODUCT_NAMES = Object.fromEntries(Object.entries(SETS).map(([id, set]) => [id, set.products.map(([name]) => name)]))

// Everything needed to fill a new shop: categories, products, a banner slide
// and homepage pictures. Plain data; createShop.js saves it.
// pictures: real photos from the Template Studio (optional), used instead of
// the drawn pictures wherever one is given
export function sampleContent(template, shopName, pictures = null) {
  const photo = pictures && typeof pictures === 'object' ? pictures : {}
  const set = SETS[template] || SETS.classic
  const [from, to] = set.colours

  const categories = set.categories.map(([name, label]) => ({ name, label, parent: null, isSample: true }))

  const products = set.products.map(([name, price, category, sizes, description, extra = {}], i) => ({
    name,
    price,
    category,
    sizes,
    description,
    image: photo.products?.[name] || samplePicture(name, from, to),
    hoverImage: '',
    images: [],
    // a couple of items on sale so the sale styling shows
    ...(i === 1 ? { onSale: true, oldPrice: Math.round(price * 1.25) } : {}),
    ...extra,
    isSample: true,
  }))

  const banner = samplePicture(shopName, to, from, { width: 1600, height: 900 })
  const slide = {
    mediaType: 'image',
    mediaUrl: photo.hero || banner,
    heading: `Welcome to ${shopName}`,
    text: 'Fresh picks, fair prices, fast delivery.',
    buttonLabel: 'Shop now',
    buttonLink: '/shop',
    order: 0,
    active: true,
    isSample: true,
  }

  const settings = {
    homeCategoryRow: { enabled: true, title: 'Popular picks', category: set.row },
    homeBanner: { image: photo.banner || samplePicture('New arrivals', from, to, { width: 1600, height: 700 }) },
    homeFeatured: { image: photo.featured || samplePicture(shopName, to, from, { width: 900, height: 1100 }), title: 'Featured collection' },
    // food shops usually sell for pickup and delivery the same day
    ...(template === 'fresh' ? { pickup: { readyTime: 'Usually ready in 30 to 60 minutes' } } : {}),
  }

  return { categories, products, slide, settings }
}
