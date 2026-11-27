import { cleanSections, SectionError } from './sections.js'

// What a template puts on a new shop's homepage, on top of its look:
//   hero:         the words on the first banner slide
//   homeSections: the homepage, top to bottom (the same sections as the builder)
// "{shop}" in any text becomes the shop's name. Pictures left empty are filled
// in when the shop is made (the template's photos, or drawn sample pictures).
//
// Built-in templates have theirs here; Template Studio templates keep their
// own (StudioTemplate.content), made in the Studio's Homepage tab.

// Section ids need 4+ characters (utils/sections.js)
const sid = (id) => `s-${id}`
const products = (id, title, source, extra = {}) => ({
  id: sid(id),
  type: 'products',
  enabled: true,
  data: { title, subtitle: '', source, category: '', count: 8, layout: 'grid', ...extra },
})
const fromCategory = (id, title, category, extra = {}) => products(id, title, 'category', { category, ...extra })
const banner = (id, heading, text, buttonLabel, buttonLink = '/shop') => ({ id: sid(id), type: 'banner', enabled: true, data: { image: '', heading, text, buttonLabel, buttonLink } })
const featured = (id, title, category, buttonLabel = 'View all') => ({
  id: sid(id),
  type: 'featured',
  enabled: true,
  data: { title, image: '', category, buttonLabel, buttonLink: category ? `/category/${category}` : '/shop' },
})
const words = (id, heading, text, align = 'center') => ({ id: sid(id), type: 'text', enabled: true, data: { heading, text, align } })
const story = (id, heading, text, buttonLabel, buttonLink = '/about', imageSide = 'left') => ({
  id: sid(id),
  type: 'imageText',
  enabled: true,
  data: { image: '', heading, text, buttonLabel, buttonLink, imageSide },
})
const quotes = (id, title, items) => ({ id: sid(id), type: 'testimonials', enabled: true, data: { title, items: items.map(([quote, name]) => ({ quote, name })) } })
const whatsapp = (id, heading, text, buttonLabel = 'Chat on WhatsApp') => ({ id: sid(id), type: 'whatsapp', enabled: true, data: { heading, text, buttonLabel } })
const HERO = { id: 'hero', type: 'hero', enabled: true, data: {} }

export const BUILTIN_CONTENT = {
  classic: {
    hero: { heading: 'Welcome to {shop}', text: "Everyday clothes you'll love wearing.", buttonLabel: 'Shop now', buttonLink: '/shop' },
    homeSections: [
      HERO,
      products('new', 'New arrivals', 'newest', { subtitle: 'Fresh in this week' }),
      banner('sale', 'Weekend sale', 'Up to 30% off selected items', 'Shop the sale'),
      products('best', 'Best sellers', 'bestsellers', { layout: 'carousel', count: 10 }),
      featured('feature', 'Accessories', 'accessories'),
      quotes('reviews', 'What our customers say', [
        ['Fast delivery and exactly as pictured. I will order again!', 'Chioma, Lagos'],
        ['Great quality for the price. Highly recommend.', 'Musa, Abuja'],
        ['The fit is perfect and the fabric is soft.', 'Ifeoma, Enugu'],
      ]),
      whatsapp('chat', 'Questions? Chat with us', 'We usually reply within minutes.'),
    ],
  },
  minimal: {
    hero: { heading: '{shop}', text: 'Quiet pieces, made to last.', buttonLabel: 'Discover', buttonLink: '/shop' },
    homeSections: [
      HERO,
      products('edit', 'The new edit', 'newest', { subtitle: 'Chosen by hand this week', count: 6 }),
      story('story', 'Our story', 'Every piece is chosen for its fabric, its fit and how long it will last. Fewer, better things.', 'Read more'),
      featured('feature', 'Women', 'women', 'Shop women'),
      quotes('reviews', 'Kind words', [
        ['Beautiful quality. It feels like it will last for years.', 'Amaka, Lagos'],
        ['Simple, elegant and delivered beautifully wrapped.', 'Zainab, Abuja'],
      ]),
      words('delivery', 'Free delivery', 'On orders over ₦50,000 in Lagos and Abuja.'),
    ],
  },
  bold: {
    hero: { heading: 'The new drop is live', text: "Limited pieces. When they're gone, they're gone.", buttonLabel: 'Shop the drop', buttonLink: '/shop' },
    homeSections: [
      HERO,
      products('drop', 'Just dropped', 'newest', { layout: 'carousel', count: 10 }),
      banner('sneakers', 'Sneaker week', 'Fresh pairs every Friday', 'Cop now', '/category/sneakers'),
      fromCategory('kicks', 'Sneakers', 'sneakers'),
      fromCategory('street', 'Streetwear', 'streetwear'),
      whatsapp('chat', 'Want your size held?', 'Send us a message and we will keep it for 24 hours.', 'Message us'),
    ],
  },
  fresh: {
    hero: { heading: 'Hot meals from {shop}', text: 'Order before 2pm for lunch delivery today.', buttonLabel: 'Order now', buttonLink: '/shop' },
    homeSections: [
      HERO,
      fromCategory('menu', "Today's menu", 'meals', { subtitle: 'Cooked fresh every morning', count: 12 }),
      words('how', 'How to order', 'Pick your meals, pay online, by transfer or on delivery, and we bring them to you hot within the hour.'),
      fromCategory('chops', 'Small chops', 'small-chops', { layout: 'carousel' }),
      fromCategory('drinks', 'Drinks', 'drinks', { layout: 'carousel' }),
      quotes('reviews', 'What our customers say', [
        ['The jollof tastes like a real party. Still hot when it arrived!', 'Tunde, Lagos'],
        ['My go-to for office lunch. Never late.', 'Blessing, Abuja'],
        ['Generous portions and the zobo is perfect.', 'Kemi, Ibadan'],
      ]),
      whatsapp('chat', 'Order on WhatsApp', 'Prefer to chat? Send us your order and address.', 'Order on WhatsApp'),
    ],
  },
  catalog: {
    hero: { heading: 'Everything for your home', text: 'Big brands, everyday prices, delivered fast.', buttonLabel: 'Start shopping', buttonLink: '/shop' },
    homeSections: [
      HERO,
      products('deals', 'Deals of the day', 'newest', { count: 10 }),
      fromCategory('kitchen', 'Kitchen', 'kitchen', { layout: 'carousel' }),
      banner('delivery', 'Free delivery over ₦30,000', 'On all home and kitchen items', 'Shop home', '/category/home'),
      fromCategory('electronics', 'Electronics', 'electronics', { count: 10 }),
      fromCategory('care', 'Personal care', 'personal-care', { layout: 'carousel' }),
      whatsapp('chat', 'Need help with an order?', 'Our team replies within minutes.'),
    ],
  },
  glow: {
    hero: { heading: 'Glow, naturally', text: 'Skincare made for melanin-rich skin.', buttonLabel: 'Shop skincare', buttonLink: '/category/skincare' },
    homeSections: [
      HERO,
      products('loved', 'Customer favourites', 'bestsellers'),
      story('clean', 'Clean ingredients', 'No harsh chemicals, no fillers. Just ingredients your skin knows, tested on real people.', 'Our ingredients', '/about', 'right'),
      fromCategory('skin', 'Skincare', 'skincare', { layout: 'carousel' }),
      fromCategory('scent', 'Fragrance', 'fragrance'),
      quotes('reviews', 'Real results', [
        ['My dark spots faded in three weeks. I am obsessed.', 'Funke, Lagos'],
        ['Gentle, smells amazing and lasts for months.', 'Hauwa, Kaduna'],
      ]),
    ],
  },
  tech: {
    hero: { heading: 'Genuine gadgets, guaranteed', text: 'Fast delivery and a 12-month warranty on every device.', buttonLabel: 'Shop phones', buttonLink: '/category/phones' },
    homeSections: [
      HERO,
      fromCategory('phones', 'Phones', 'phones'),
      banner('tradein', 'Trade in your old phone', 'Get money off a new one', 'Find out how', '/contact'),
      fromCategory('audio', 'Audio', 'audio', { layout: 'carousel' }),
      featured('feature', 'Accessories', 'accessories', 'Shop accessories'),
      words('why', 'Why buy from us', 'Genuine products only. 12-month warranty. Pay on delivery in Lagos and Abuja.'),
      whatsapp('chat', 'Need help choosing?', 'Tell us your budget and we will suggest the best fit.'),
    ],
  },
  playful: {
    hero: { heading: 'Little things, big smiles', text: 'Clothes, toys and school bits for happy kids.', buttonLabel: 'Shop now', buttonLink: '/shop' },
    homeSections: [
      HERO,
      products('new', 'New for little ones', 'newest', { layout: 'carousel' }),
      fromCategory('toys', 'Toys', 'toys'),
      banner('school', 'Back to school', 'Bags, crayons and everything for the new term', 'Get ready', '/category/school'),
      fromCategory('baby', 'Baby', 'baby'),
      quotes('reviews', 'Happy parents', [
        ['My daughter has not put the teddy down since it arrived.', 'Ngozi, Port Harcourt'],
        ['Soft, safe and delivered the next day.', 'Ahmed, Kano'],
      ]),
    ],
  },
  gadget: {
    hero: { heading: '{shop}', text: 'Phones, audio and accessories at fair prices.', buttonLabel: 'Browse all', buttonLink: '/shop' },
    homeSections: [
      HERO,
      products('new', 'New in', 'newest', { count: 12 }),
      products('top', 'Top sellers', 'bestsellers', { layout: 'carousel' }),
      fromCategory('audio', 'Audio', 'audio'),
      words('why', 'Every device is genuine', '12-month warranty, 7-day returns and pay on delivery.'),
    ],
  },
  atelier: {
    hero: { heading: 'The new collection', text: 'Designed in Lagos, made in small batches.', buttonLabel: 'Discover', buttonLink: '/shop' },
    homeSections: [
      HERO,
      products('new', 'New in', 'newest', { count: 6 }),
      story('atelier', 'The atelier', 'Each piece is cut and sewn by our team of six, in our studio in Yaba.', 'Visit us', '/about', 'right'),
      fromCategory('acc', 'Accessories', 'accessories', { layout: 'carousel' }),
      quotes('reviews', 'From our clients', [
        ['The tailoring is impeccable. I felt like royalty.', 'Adaeze, Lagos'],
        ['Worth every naira.', 'Folake, Abuja'],
      ]),
    ],
  },
  // The Furnish homepage (frontend packs/furnish) shows the first product
  // row as its collection slider and the first review over a photo
  furnish: {
    hero: { heading: 'Furniture that feels like home', text: 'Comfortable, well made pieces for every room.', buttonLabel: 'Shop now', buttonLink: '/shop' },
    homeSections: [
      HERO,
      products('collection', 'Our favourite collection', 'newest', { subtitle: 'Pieces for how we live today, where home and work share the same rooms.', count: 9 }),
      quotes('reviews', 'What our customers say', [
        ['The sofa is even more comfortable than it looked. Delivery was quick and careful.', 'Bola, Lagos'],
        ['Solid, beautiful pieces. Our living room finally feels finished.', 'Emeka, Abuja'],
      ]),
      fromCategory('chairs', 'Chairs', 'chairs', { layout: 'carousel' }),
      fromCategory('sofas', 'Sofas', 'sofas'),
      words('delivery', 'Delivery and setup', 'We deliver within Lagos and Abuja and set your furniture up for you.'),
      whatsapp('chat', 'Need help choosing?', 'Send us a photo of your space and we will suggest pieces that fit.'),
    ],
  },
  // The Bloom homepage (frontend packs/bloom) shows the first text section as
  // a big headline, then a clean product grid
  bloom: {
    hero: { heading: 'Step into style', text: 'Comfort, design and performance in every pair.', buttonLabel: 'Shop now', buttonLink: '/shop' },
    homeSections: [
      HERO,
      words('intro', 'Step into style', 'Discover our latest sneakers: comfort, design and performance in every pair.'),
      products('all', 'Latest pairs', 'newest', { count: 9 }),
      fromCategory('running', 'Running', 'running', { layout: 'carousel' }),
      whatsapp('chat', 'Not sure about your size?', 'Message us and we will help you pick the right fit.'),
    ],
  },
}

const line = (value, max) => (typeof value === 'string' ? value.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '')

// The Studio's content, checked: only known sections and safe values are kept.
// Nothing sent (an older template) -> null, meaning "the built-in's / standard".
export function cleanContent(input) {
  if (input === undefined || input === null) return null
  if (typeof input !== 'object') throw new SectionError('Homepage content must be an object')
  const hero = input.hero && typeof input.hero === 'object' ? input.hero : {}
  const link = typeof hero.buttonLink === 'string' && /^\/[a-z0-9/_-]*$/i.test(hero.buttonLink.trim()) ? hero.buttonLink.trim() : '/shop'
  return {
    hero: {
      heading: line(hero.heading, 120),
      text: line(hero.text, 300),
      buttonLabel: line(hero.buttonLabel, 40),
      buttonLink: link,
    },
    homeSections: cleanSections(Array.isArray(input.homeSections) ? input.homeSections : []),
  }
}

// The content for a built-in id or as the Studio saved it
export const builtInContent = (id) => BUILTIN_CONTENT[id] || BUILTIN_CONTENT.classic

// Ready for one shop: "{shop}" replaced and empty pictures filled in.
// picture(slot, index) gives a picture for 'banner' | 'featured' | 'story'.
// categories: the shop's category names; a row for a category the shop
// doesn't have shows the newest products instead of an empty row.
export function contentForShop(content, shopName, picture, categories = null) {
  const c = content || BUILTIN_CONTENT.classic
  const name = (value) => (typeof value === 'string' ? value.replaceAll('{shop}', shopName) : value)
  const slot = { banner: 'banner', featured: 'featured', imageText: 'story' }
  const homeSections = (c.homeSections || []).map((s, i) => {
    const data = Object.fromEntries(Object.entries(s.data || {}).map(([k, v]) => [k, Array.isArray(v) ? v.map((item) => (item && typeof item === 'object' ? Object.fromEntries(Object.entries(item).map(([a, b]) => [a, name(b)])) : item)) : name(v)]))
    if (slot[s.type] && !data.image) data.image = picture(slot[s.type], i)
    if (categories && data.category && !categories.includes(data.category)) {
      data.category = ''
      if (data.source === 'category') data.source = 'newest'
      if (typeof data.buttonLink === 'string' && data.buttonLink.startsWith('/category/')) data.buttonLink = '/shop'
    }
    return { ...s, data }
  })
  const hero = c.hero || {}
  return {
    hero: { heading: name(hero.heading || ''), text: name(hero.text || ''), buttonLabel: hero.buttonLabel || '', buttonLink: hero.buttonLink || '/shop' },
    homeSections,
  }
}
