// Starter wording for a new store. It is generic on purpose: anything in
// [square brackets] is a detail only the owner knows, and the admin page
// flags pages that still contain brackets as "Needs your details".
// This is not legal advice, so have the policies reviewed before launch.

export const DEFAULT_PAGES = [
  {
    slug: 'faq',
    title: 'FAQ',
    footerColumn: 'resources',
    order: 1,
    content: `## How do I place an order?
Add the items you like to your cart, go to checkout, fill in your details and pay securely online.

## How can I pay?
Payments are handled by Paystack, which accepts cards and other online payment options. We never see or store your card details.

## How long will delivery take?
Delivery usually takes [2 to 5] working days. You will see the delivery fee at checkout before you pay. See our Shipping Policy for more detail.

## Can I collect my order in store?
Yes. Choose Pick up at checkout and we will let you know when your order is ready.

## How do I track my order?
Log in and open Orders to see the latest status of your order. We also email you when it ships.

## Can I return something?
Yes, as long as it meets the conditions in our Refund Policy.

## How do I contact you?
Tap the Chat With Us button or visit our Contact page.`,
  },
  {
    slug: 'shipping-policy',
    title: 'Shipping Policy',
    footerColumn: 'resources',
    order: 2,
    content: `## Processing time
Orders are prepared within [1 to 2] working days after payment is confirmed. Orders placed on weekends or public holidays are processed on the next working day.

## Delivery time
- Within Abuja: [1 to 3] working days
- Other parts of Nigeria: [3 to 7] working days

These are estimates, not guarantees. Delays can happen because of weather, traffic or courier issues.

## Delivery fees
The delivery fee is shown at checkout before you pay. Free delivery may apply to orders above a certain value when we are running that offer.

## Store pickup
Choose Pick up at checkout to collect your order from our store at no extra cost. We will tell you when it is ready.

## Tracking
When your order ships we update its status, and you can follow it under Orders after you log in.

## Wrong or incomplete address
Please check your address and phone number carefully before paying. We cannot be responsible for orders that are delayed or lost because of incorrect details.`,
  },
  {
    slug: 'privacy',
    title: 'Privacy Policy',
    footerColumn: 'resources',
    order: 3,
    content: `## What we collect
When you create an account or place an order we collect your name, email address, phone number, delivery address and order history.

## How we use it
We use your details to process and deliver your orders, send order updates, answer your questions and keep your account secure.

## Payments
Payments are processed by Paystack. We do not see or store your full card details.

## Who we share it with
We only share what is needed with the services that help us run the store, such as our payment provider, delivery partners and email provider. We do not sell your personal information.

## Cookies and local storage
We use your browser's storage to keep you logged in and to remember the items in your cart.

## Your choices
You can ask us to see, correct or delete your personal information at any time by contacting us at [your email address].

## Changes to this policy
We may update this policy from time to time. The latest version is always on this page.`,
  },
  {
    slug: 'refund-policy',
    title: 'Refund Policy',
    footerColumn: 'resources',
    order: 4,
    content: `## Returns
You can ask to return an item within [7] days of receiving it. The item must be unused, in its original condition and packaging, with any tags still attached.

## Items we cannot take back
[List any items that cannot be returned, for example underwear, sale items or personalised products.]

## How to start a return
Contact us with your order number and the reason for the return. We will tell you what to do next.

## Refunds
Once we receive and check your return, we will refund the amount you paid for the item to your original payment method. This usually takes [5 to 10] working days to show in your account. Delivery fees are not refunded unless the return is our mistake.

## Damaged or wrong items
If your order arrives damaged or is not what you ordered, contact us within [48 hours] of delivery with photos and we will put it right.

## Cancelling an order
You can cancel an order before it is dispatched. Contact us as soon as possible with your order number.`,
  },
  {
    slug: 'terms',
    title: 'Terms Of Service',
    footerColumn: 'resources',
    order: 5,
    content: `## Using this store
By using this website and placing an order you agree to these terms. If you do not agree, please do not use the store.

## Orders and prices
All prices are in Nigerian Naira. We try to keep prices and stock information accurate, but mistakes can happen. We may cancel or correct an order affected by a pricing or stock error, and we will refund anything you have paid for it.

## Payment
You must pay in full when you place your order. Payments are processed securely by our payment provider.

## Delivery and returns
Delivery is covered in our Shipping Policy, and returns and refunds are covered in our Refund Policy. Both form part of these terms.

## Your account
You are responsible for keeping your login details private and for activity on your account.

## Our content
The photos, text and designs on this site belong to us or are used with permission. Please do not copy them without asking first.

## Our responsibility
We do our best to provide a reliable service, but we are not liable for losses caused by things outside our control. Nothing in these terms limits your rights under Nigerian consumer law.

## Changes
We may update these terms from time to time. Using the store after a change means you accept the new terms.

## Contact
Questions about these terms? Contact us at [your email address].`,
  },
  {
    slug: 'about',
    title: 'About Us',
    footerColumn: 'support',
    order: 1,
    content: `## Our story
Welcome to our store. We sell [what you sell] to customers across Nigeria.

[Tell customers who you are, how you started and what makes your store different.]

## What we care about
- Quality products we are proud to sell
- Fair prices and honest service
- Fast, reliable delivery

## Visit us
You can also shop with us in person. Our address is in the footer of every page.`,
  },
  {
    slug: 'contact',
    title: 'Contact Us',
    footerColumn: 'support',
    order: 2,
    content: `## We're happy to help
Have a question about an order, a product or a delivery? Reach us using the details below, or tap the Chat With Us button to message us on WhatsApp.

Please include your order number if your question is about an existing order, so we can help faster.`,
  },
]