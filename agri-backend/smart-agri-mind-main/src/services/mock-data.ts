import type {
  AppNotification,
  BotAnswer,
  ColdChainFacility,
  Faq,
  FarmerProfile,
  FpoPool,
  Testimonial,
  TickerQuote,
} from "./types";

export const PROFILE: FarmerProfile = {
  id: "FARM-1042",
  name: "Ramesh Patil",
  phone: "+91 98765 43210",
  email: "ramesh.patil@agrisense.in",
  language: "Marathi",
  village: "Dindori",
  district: "Nashik",
  state: "Maharashtra",
  lat: 20.2,
  lng: 73.83,
  landholdingAcres: 6.5,
  primaryCrops: "Tomato, Onion, Soybean",
  soilType: "Black cotton (regur)",
  irrigation: "Drip · borewell",
  kyc: "verified",
  bank: {
    holder: "Ramesh Sitaram Patil",
    accountNumber: "XXXX XXXX 4412",
    ifsc: "MAHB0001129",
    upiId: "ramesh.patil@upi",
    autoSettlement: true,
  },
  notifications: {
    priceAlerts: true,
    buyerBids: true,
    logistics: true,
    settlements: true,
    whatsapp: false,
  },
};

export const NOTIFICATION_FEED: AppNotification[] = [
  {
    id: "N-01",
    category: "bids",
    title: "Buyer A raised the offer to ₹30/kg",
    body: "Sahyadri Foods needs 6,000 kg of Grade A tomato this week.",
    time: "14 minutes ago",
    read: false,
    link: { to: "/buyers", label: "View buyer" },
  },
  {
    id: "N-02",
    category: "price",
    title: "Nashik APMC arrivals down 12%",
    body: "Tomato prices firmed to ₹28/kg — net realization now ₹26/kg.",
    time: "2 hours ago",
    read: false,
    link: { to: "/markets", label: "See markets" },
  },
  {
    id: "N-03",
    category: "logistics",
    title: "Consignment TRK-3391 departed Dindori",
    body: "12 km covered · expected at Nashik MIDC by 13:00.",
    time: "4 hours ago",
    read: false,
    link: { to: "/logistics", label: "Track consignment" },
  },
  {
    id: "N-04",
    category: "settlements",
    title: "₹75,000 advance credited",
    body: "50% advance for ORD-8841 received · UTR 4429183021.",
    time: "Yesterday",
    read: true,
    link: { to: "/payments", label: "Open settlement" },
  },
  {
    id: "N-05",
    category: "price",
    title: "Forecast updated for tomato",
    body: "Peak of ₹31.5/kg expected in the week of 26 Sep.",
    time: "Yesterday",
    read: true,
    link: { to: "/forecast", label: "See forecast" },
  },
  {
    id: "N-06",
    category: "logistics",
    title: "Shared tempo available on 16 Sep",
    body: "Open tempo · 6 t capacity for the Lasalgaon route.",
    time: "2 days ago",
    read: true,
    link: { to: "/logistics", label: "View logistics" },
  },
  {
    id: "N-07",
    category: "bids",
    title: "GreenLeaf Exports enquired for pomegranate",
    body: "Export grade · 3,000 kg at ₹94/kg, Net 15 days.",
    time: "3 days ago",
    read: true,
    link: { to: "/buyers", label: "View buyer" },
  },
];

export const FPO_POOLS: FpoPool[] = [
  {
    id: "POOL-TOM-01",
    crop: "Tomato",
    emoji: "🍅",
    targetKg: 15000,
    basePrice: 30,
    bulkPrice: 33.5,
    soloFreight: 2,
    pooledFreight: 1.2,
    contractStatus: "Open for pooling",
    members: [
      { id: "M1", name: "Farmer A · Ramesh Patil", village: "Dindori", crop: "Tomato", grade: "Grade A", quantity: 5000 },
      { id: "M2", name: "Farmer B · Sunita Jadhav", village: "Vani", crop: "Tomato", grade: "Grade A", quantity: 3000 },
      { id: "M3", name: "Farmer C · Kailas More", village: "Ozar", crop: "Tomato", grade: "Grade B", quantity: 7000 },
      { id: "M4", name: "Farmer D · Anita Wagh", village: "Pimpalgaon", crop: "Tomato", grade: "Grade A", quantity: 2500 },
    ],
    bids: [
      { id: "B1", buyer: "Sahyadri Foods", pricePerKg: 33.5, minQuantity: 12000, terms: "50% advance · balance in 3 days", status: "Negotiating" },
      { id: "B2", buyer: "Mumbai Fresh Co.", pricePerKg: 34.2, minQuantity: 15000, terms: "Payment on delivery", status: "Open" },
      { id: "B3", buyer: "GreenLeaf Exports", pricePerKg: 35, minQuantity: 18000, terms: "Net 15 days", status: "Open" },
    ],
    payouts: [
      { member: "Farmer A · Ramesh Patil", quantity: 5000, amount: 167500, status: "Scheduled" },
      { member: "Farmer B · Sunita Jadhav", quantity: 3000, amount: 100500, status: "Scheduled" },
      { member: "Farmer C · Kailas More", quantity: 7000, amount: 224000, status: "Scheduled" },
      { member: "Farmer D · Anita Wagh", quantity: 2500, amount: 83750, status: "Paid" },
    ],
  },
  {
    id: "POOL-ONI-02",
    crop: "Onion",
    emoji: "🧅",
    targetKg: 30000,
    basePrice: 18,
    bulkPrice: 20.4,
    soloFreight: 2.6,
    pooledFreight: 1.5,
    contractStatus: "Contract signed",
    members: [
      { id: "M5", name: "Farmer E · Dnyaneshwar Shinde", village: "Lasalgaon", crop: "Onion", grade: "Grade B", quantity: 12000 },
      { id: "M6", name: "Farmer F · Vaishali Gaikwad", village: "Chandwad", crop: "Onion", grade: "Grade A", quantity: 9000 },
      { id: "M7", name: "Farmer G · Bhausaheb Kale", village: "Yeola", crop: "Onion", grade: "Grade B", quantity: 9500 },
    ],
    bids: [
      { id: "B4", buyer: "Annapurna Retail", pricePerKg: 20.4, minQuantity: 25000, terms: "Net 7 days", status: "Accepted" },
      { id: "B5", buyer: "AgroPure Processing", pricePerKg: 19.8, minQuantity: 20000, terms: "Net 10 days", status: "Open" },
    ],
    payouts: [
      { member: "Farmer E · Dnyaneshwar Shinde", quantity: 12000, amount: 244800, status: "Paid" },
      { member: "Farmer F · Vaishali Gaikwad", quantity: 9000, amount: 183600, status: "Paid" },
      { member: "Farmer G · Bhausaheb Kale", quantity: 9500, amount: 193800, status: "Scheduled" },
    ],
  },
];

export const TICKER: TickerQuote[] = [
  { crop: "Tomato", mandi: "Nashik APMC", price: 28, change: 3.2 },
  { crop: "Onion", mandi: "Lasalgaon APMC", price: 18.4, change: 1.4 },
  { crop: "Soybean", mandi: "Latur APMC", price: 46, change: -1.1 },
  { crop: "Pomegranate", mandi: "Sangola", price: 92, change: 4.6 },
  { crop: "Tomato", mandi: "Mumbai Vashi", price: 34, change: 6.1 },
  { crop: "Chilli", mandi: "Guntur", price: 118, change: -0.8 },
  { crop: "Grapes", mandi: "Pimpalgaon", price: 62, change: 2.3 },
];

export const TESTIMONIALS: Testimonial[] = [
  {
    name: "Ramesh Patil",
    place: "Dindori, Nashik",
    crop: "Tomato",
    quote:
      "The mandi 168 km away showed the best price. AgriSense showed me the freight and I sold 22 km away instead.",
    gain: "+₹4/kg net",
  },
  {
    name: "Sunita Jadhav",
    place: "Vani, Nashik",
    crop: "Onion",
    quote:
      "Holding onion felt safe until the storage loss was shown against the forecast. I split the lot and slept better.",
    gain: "+₹1.8/kg net",
  },
  {
    name: "Dnyaneshwar Shinde",
    place: "Lasalgaon, Nashik",
    crop: "Onion",
    quote:
      "Our FPO pooled 30 tonnes in one week. Bulk tier price plus a shared truck changed the whole season.",
    gain: "+₹2.4/kg net",
  },
  {
    name: "Bhagyashri Kadam",
    place: "Sangola, Solapur",
    crop: "Pomegranate",
    quote:
      "Reliability scores stopped a payment dispute before it started. I now check the score before loading.",
    gain: "0 payment delays",
  },
];

export const FAQS: Faq[] = [
  {
    q: "How is net realization calculated?",
    a: "We take the buyer or mandi headline price and subtract road freight for your exact distance, storage or holding cost and expected grading loss. What remains is what reaches your hand.",
  },
  {
    q: "Where do the mandi prices come from?",
    a: "This prototype runs on demo data modelled on APMC arrival and price patterns for Maharashtra, Karnataka and Andhra Pradesh belts.",
  },
  {
    q: "What does the reliability score mean?",
    a: "It is built from a buyer's completed transactions, on-time payment ratio and open disputes. A high price from a low-reliability buyer is ranked down.",
  },
  {
    q: "Can an FPO use one account for many farmers?",
    a: "Yes. The FPO workspace pools member lots into a single aggregated consignment, unlocking bulk tier prices and lower per-kg freight.",
  },
  {
    q: "Does AgriSense charge a commission on my sale?",
    a: "No commission on the produce value. The demo shows freight and settlement costs only.",
  },
];

export const TRUST_METRICS = [
  { label: "Verified buyers", value: "412", hint: "KYC and GST checked" },
  { label: "Settlements tracked", value: "₹18.4 Cr", hint: "Across 2026" },
  { label: "On-time payments", value: "98%", hint: "Last 12 months" },
  { label: "Data encrypted", value: "AES-256", hint: "At rest and in transit" },
];

export const COLD_CHAIN_FACILITIES: ColdChainFacility[] = [
  {
    id: "mkcc",
    name: "Maharashtra Kisan Cold Chain Logistics",
    kind: "Reefer transport",
    place: "Pimpalgaon Baswant",
    district: "Nashik",
    contact: "Sachin Kadam",
    phone: "+91 98220 19911",
    rating: 4.9,
    verified: true,
    tempRange: "-25°C to +15°C (GPS & temperature logged)",
    capacity: "9 reefer trucks · 6–18 t",
    ratePerKm: 48,
    wdra: false,
  },
  {
    id: "sahyadri-warehouse",
    name: "Sahyadri Mega Agro Warehouse & Cold Storage",
    kind: "Warehouse & cold storage",
    place: "Mohadi, Dindori",
    district: "Nashik",
    contact: "Dr. Pravin Gore",
    phone: "+91 98230 78822",
    rating: 4.95,
    verified: true,
    tempRange: "+2°C to +8°C multi-chamber",
    capacity: "12,000 t · WDRA accredited",
    storagePerQuintalPerDay: 3.2,
    ratePerKm: 42,
    wdra: true,
  },
  {
    id: "lasalgaon-silo",
    name: "Lasalgaon Onion Dry Storage Silos",
    kind: "Dry storage silo",
    place: "Lasalgaon",
    district: "Nashik",
    contact: "Vaishali Pawar",
    phone: "+91 90280 44510",
    rating: 4.7,
    verified: true,
    tempRange: "Ambient · forced ventilation",
    capacity: "4,500 t onion chawls",
    storagePerQuintalPerDay: 1.4,
    ratePerKm: 36,
    wdra: true,
  },
  {
    id: "godavari-reefer",
    name: "Godavari Reefer & Packhouse Network",
    kind: "Reefer transport",
    place: "Ozar",
    district: "Nashik",
    contact: "Imran Shaikh",
    phone: "+91 97640 21188",
    rating: 4.6,
    verified: true,
    tempRange: "-18°C to +12°C",
    capacity: "Shared load · 3 t minimum",
    ratePerKm: 39,
    wdra: false,
  },
];

export const BOT_ANSWERS: BotAnswer[] = [
  {
    id: "onion-rate",
    chip: "कांद्याचा आजचा भाव? / Onion Rate",
    answer: {
      en: "Lasalgaon APMC onion is trading at ₹18/kg today (arrivals 310 t, up 1.4% this week). Nashik APMC is ₹17.4/kg. From Dindori the freight is about ₹2.6/kg, so your net realization is close to ₹15.4/kg. Grade B stock is holding better than Grade C this week.",
      hi: "आज लासलगांव APMC में प्याज ₹18/किलो चल रहा है (आवक 310 टन, इस हफ्ते +1.4%)। नाशिक APMC ₹17.4/किलो है। दिंडोरी से भाड़ा लगभग ₹2.6/किलो, यानी शुद्ध ₹15.4/किलो। इस हफ्ते ग्रेड B, ग्रेड C से बेहतर टिक रहा है।",
      mr: "आज लासलगाव APMC मध्ये कांदा ₹18/किलो आहे (आवक 310 टन, या आठवड्यात +1.4%). नाशिक APMC ₹17.4/किलो. दिंडोरीहून वाहतूक अंदाजे ₹2.6/किलो, म्हणजे निव्वळ ₹15.4/किलो. या आठवड्यात ग्रेड B, ग्रेड C पेक्षा चांगला टिकतो आहे.",
      pa: "ਅੱਜ ਲਾਸਲਗਾਂਵ APMC ਵਿੱਚ ਪਿਆਜ਼ ਦਾ ਭਾਅ ₹18/ਕਿਲੋ ਹੈ (ਆਮਦ 310 ਟਨ, ਇਸ ਹਫ਼ਤੇ +1.4%)। ਨਾਸਿਕ ਮੰਡੀ ₹17.4/ਕਿਲੋ ਹੈ। ਭਾੜਾ ਕੱਟ ਕੇ ਸ਼ੁੱਧ ਮੁਨਾਫ਼ਾ ਲਗਭਗ ₹15.4/ਕਿਲੋ ਰਹੇਗਾ। ਗ੍ਰੇਡ B ਮਾਲ ਇਸ ਹਫ਼ਤੇ ਬਿਹਤਰ ਵਿਕ ਰਿਹਾ ਹੈ।",
      hinglish: "Aaj Lasalgaon APMC me pyaj ka bhav ₹18/kg chal raha hai (arrivals 310 tonne, is hafte +1.4% up). Nashik APMC ₹17.4/kg hai. Dindori se transport bhada lagbhag ₹2.6/kg aayega, toh aapka net realization kareeb ₹15.4/kg banega. Grade B maal Grade C se behtar perform kar raha hai.",
    },
  },
  {
    id: "soybean-timing",
    chip: "सोयाबीन कधी विकावे? / Soybean Timing",
    answer: {
      en: "Hold your Latur soybean lot for 7–10 more days. Processor demand around Latur is firm and the four-week outlook points to ₹47–48/kg against today's ₹46/kg. Dry storage loss is under 0.5% a week, so waiting costs little. Sell immediately if moisture crosses 12%.",
      hi: "लातूर का सोयाबीन 7–10 दिन और रोकें। लातूर के आसपास प्रोसेसर मांग मजबूत है और चार-सप्ताह का अनुमान ₹47–48/किलो है, आज ₹46/किलो के मुकाबले। सूखे भंडारण में नुकसान हफ्ते में 0.5% से कम है। नमी 12% से ऊपर जाए तो तुरंत बेचें।",
      mr: "लातूरचा सोयाबीन आणखी 7–10 दिवस थांबवा. लातूरजवळ प्रोसेसर मागणी मजबूत आहे आणि चार आठवड्यांचा अंदाज ₹47–48/किलो आहे, आजच्या ₹46/किलोच्या तुलनेत. कोरड्या साठवणुकीत आठवड्याला 0.5% पेक्षा कमी घट होते. ओलावा 12% च्या वर गेला तर लगेच विका.",
      pa: "ਸੋਇਆਬੀਨ ਨੂੰ 7–10 ਦਿਨ ਹੋਰ ਰੋਕ ਕੇ ਰੱਖੋ। ਪ੍ਰੋਸੈਸਰਾਂ ਦੀ ਮੰਗ ਮਜ਼ਬੂਤ ਹੈ ਅਤੇ ਆਉਣ ਵਾਲੇ ਹਫ਼ਤਿਆਂ ਵਿੱਚ ਰੇਟ ₹47–48/ਕਿਲੋ ਤੱਕ ਜਾਣ ਦੀ ਉਮੀਦ ਹੈ (ਅੱਜ ₹46/ਕਿਲੋ ਹੈ)। ਜੇਕਰ ਨਮੀ 12% ਤੋਂ ਜ਼ਿਆਦਾ ਹੋ ਜਾਵੇ ਤਾਂ ਤੁਰੰਤ ਵੇਚ ਦਿਓ।",
      hinglish: "Latur soybean lot ko abhi 7–10 din hold karein. Local processors ki demand strong hai aur 4-week forecast ₹47–48/kg ka trend dikha raha hai, jabki aaj ₹46/kg hai. Dry storage me weight loss sirf 0.5%/week hai toh hold karna profitable rahega. Agar moisture 12% se upar ho toh turant bechein.",
    },
  },
  {
    id: "pune-tomato",
    chip: "Pune Tomato Rate? / पुणे टोमॅटो भाव",
    answer: {
      en: "Pune Market Yard tomato is ₹31/kg with 530 t arrivals and high demand (+4.8% over seven days). From Dindori it is 210 km, so freight is about ₹5.5/kg and storage ₹0.5/kg — net ₹25/kg. Nashik APMC at ₹28/kg leaves you ₹26/kg net, which is the better call today.",
      hi: "पुणे मार्केट यार्ड में टमाटर ₹31/किलो, आवक 530 टन, मांग ऊँची (सात दिन में +4.8%)। दिंडोरी से 210 किमी, भाड़ा ~₹5.5/किलो और भंडारण ₹0.5/किलो — शुद्ध ₹25/किलो। नाशिक APMC ₹28/किलो पर शुद्ध ₹26/किलो देता है, आज वही बेहतर है।",
      mr: "पुणे मार्केट यार्डमध्ये टोमॅटो ₹31/किलो, आवक 530 टन, मागणी जास्त (सात दिवसांत +4.8%). दिंडोरीहून 210 किमी, वाहतूक ~₹5.5/किलो आणि साठवण ₹0.5/किलो — निव्वळ ₹25/किलो. नाशिक APMC ₹28/किलोवर निव्वळ ₹26/किलो देतो, आज तोच पर्याय चांगला.",
      pa: "ਪੁਣੇ ਮੰਡੀ ਯਾਰਡ ਵਿੱਚ ਟਮਾਟਰ ₹31/ਕਿਲੋ ਹੈ (ਮੰਗ +4.8% ਵਧੀ ਹੈ)। 210 ਕਿਲੋਮੀਟਰ ਦੂਰੀ ਕਰਕੇ ਭਾੜਾ ₹5.5/ਕਿਲੋ ਪਵੇਗਾ, ਜਿਸ ਨਾਲ ਸ਼ੁੱਧ ₹25/ਕਿਲੋ ਬਚੇਗਾ। ਨਾਸਿਕ APMC ₹28/ਕਿਲੋ ਤੇ ਸ਼ੁੱਧ ₹26/ਕਿਲੋ ਦਿੰਦੀ ਹੈ, ਇਸ ਲਈ ਨਾਸਿਕ ਵੇਚਣਾ ਅੱਜ ਜ਼ਿਆਦਾ ਫਾਇਦੇਮੰਦ ਹੈ।",
      hinglish: "Pune Market Yard me tamatar ka rate ₹31/kg hai (arrivals 530 tonne, demand high +4.8%). Dindori se 210 km door hai toh transport ₹5.5/kg lagega — net ₹25/kg bachega. Jabki Nashik APMC me ₹28/kg offer hai aur freight kam hone se net ₹26/kg mil raha hai, isliye aaj Nashik me bechna behtar option hai.",
    },
  },
  {
    id: "ai-grading",
    chip: "How does AI Grading work? / ग्रेडिंग",
    answer: {
      en: "You photograph a sample crate. AgriSense checks size spread, colour uniformity, blemishes and moisture cues, then maps the lot to Grade A, B or C using APMC grading norms. The grade decides which buyers you are matched with and the price band we use for net realization.",
      hi: "आप एक नमूना क्रेट की फोटो लेते हैं। AgriSense आकार, रंग की एकरूपता, दाग और नमी के संकेत जाँचता है और APMC मानकों के अनुसार लॉट को ग्रेड A, B या C देता है। ग्रेड तय करता है कि कौन से खरीदार मिलेंगे और शुद्ध आय किस भाव पर आँकी जाएगी।",
      mr: "तुम्ही नमुना क्रेटचा फोटो काढता. AgriSense आकार, रंगाची एकसारखेपणा, डाग आणि ओलाव्याचे संकेत तपासतो आणि APMC निकषांनुसार लॉटला ग्रेड A, B किंवा C देतो. ग्रेडवरून कोणते खरेदीदार जुळतील आणि निव्वळ उत्पन्न कोणत्या दराने मोजले जाईल हे ठरते.",
      pa: "ਤੁਸੀਂ ਆਪਣੀ ਫਸਲ ਦੀ ਫੋਟੋ ਅਪਲੋਡ ਕਰਦੇ ਹੋ। AgriSense ਆਕਾਰ, ਰੰਗ, ਦਾਗ ਅਤੇ ਨਮੀ ਦੀ ਜਾਂਚ ਕਰਕੇ APMC ਨਿਯਮਾਂ ਮੁਤਾਬਕ ਗ੍ਰੇਡ A, B ਜਾਂ C ਤੈਅ ਕਰਦਾ ਹੈ। ਇਸ ਨਾਲ ਤੁਹਾਨੂੰ ਪ੍ਰਮਾਣਿਤ ਖਰੀਦਦਾਰ ਅਤੇ ਵਧੀਆ ਰੇਟ ਮਿਲਦੇ ਹਨ।",
      hinglish: "Aap apne crop crate ki photo upload karte hain. AgriSense computer vision se size distribution, color uniformity, spots aur moisture cues check karke APMC norms ke according Grade A, B ya C assign karta hai. Sahi grade milne se premium buyers connect hote hain aur zyada rate milta hai.",
    },
  },
  {
    id: "cold-storage",
    chip: "Cold Storage Costs? / शीतगृह खर्च",
    answer: {
      en: "Cold storage in the Nashik/Dindori belt costs ₹1.40 to ₹3.20 per quintal per day. Facilities like Sahyadri Mega Warehouse offer WDRA-certified storage (+2°C to +8°C) with bank pledge finance up to 70% of lot value. Dry onion chawls cost around ₹1.40/quintal/day.",
      hi: "नाशिक/दिंडोरी क्षेत्र में कोल्ड स्टोरेज का खर्च ₹1.40 से ₹3.20 प्रति क्विंटल प्रति दिन है। सह्याद्री वेयरहाउस जैसी WDRA मान्यता प्राप्त सुविधाएं (+2°C से +8°C) लॉट मूल्य का 70% तक बैंक लोन भी देती हैं। प्याज भंडारण की लागत लगभग ₹1.40/क्विंटल/दिन है।",
      mr: "नाशिक/दिंडोरी पट्ट्यात शीतगृहाचा खर्च ₹1.40 ते ₹3.20 प्रति क्विंटल प्रति दिवस आहे. सह्याद्री वेअरहाऊससारख्या WDRA मान्यताप्राप्त सुविधा (+2°C ते +8°C) मालतारण कर्जाची (70% पर्यंत) सुविधा देतात. कांदा साठवणुकीचा खर्च ₹1.40/क्विंटल/दिवस आहे.",
      pa: "ਕੋਲਡ ਸਟੋਰੇਜ ਦਾ ਖਰਚਾ ਲਗਭਗ ₹1.40 ਤੋਂ ₹3.20 ਪ੍ਰਤੀ ਕੁਇੰਟਲ ਪ੍ਰਤੀ ਦਿਨ ਹੈ। WDRA ਪ੍ਰਮਾਣਿਤ ਸਟੋਰੇਜ ਵਿੱਚ ਮਾਲ ਰੱਖ ਕੇ ਤੁਸੀਂ ਫਸਲ ਤੇ 70% ਤੱਕ ਬੈਂਕ ਲੋਨ ਵੀ ਲੈ ਸਕਦੇ ਹੋ।",
      hinglish: "Nashik aur Dindori belt me cold storage ka rate ₹1.40 se ₹3.20 per quintal per day hai. Sahyadri jaise WDRA-certified warehouses me +2°C to +8°C multi-chamber storage milta hai jahan aapko crop value par 70% tak bank pledge loan bhi mil sakta hai.",
    },
  },
  {
    id: "payment-escrow",
    chip: "Payment & Escrow / सुरक्षित पेमेंट",
    answer: {
      en: "All AgriConnect trades are protected by digital escrow. 50% advance payment is locked when the buyer accepts the order and released upon truck loading at your farm gate. The remaining 50% settles directly into your verified bank/UPI account within 24 hours of weighbridge confirmation.",
      hi: "AgriConnect के सभी सौदे डिजिटल एस्क्रो से सुरक्षित हैं। खरीदार द्वारा ऑर्डर स्वीकार करने पर 50% अग्रिम राशि लॉक हो जाती है और फार्म गेट पर लोडिंग होते ही जारी कर दी जाती है। शेष 50% डिलीवरी के 24 घंटे के भीतर सीधे आपके बैंक/UPI खाते में जमा हो जाता है।",
      mr: "AgriConnect वरील सर्व व्यवहार डिजिटल एस्क्रो खात्याद्वारे सुरक्षित आहेत. खरेदीदाराने ऑर्डर स्वीकारल्यावर 50% आगाऊ रक्कम लॉक होते आणि शेतात लोडिंग झाल्यावर त्वरित रिलीज केली जाते. उर्वरित 50% वजन पावतीनंतर 24 तासांच्या आत थेट तुमच्या बँक खात्यात जमा होते.",
      pa: "ਸਾਰੇ ਭੁਗਤਾਨ ਐਸਕਰੋ (Escrow) ਸਿਸਟਮ ਰਾਹੀਂ ਸੁਰੱਖਿਅਤ ਹਨ। ਟਰੱਕ ਲੋਡਿੰਗ ਤੇ 50% ਪੇਸ਼ਗੀ ਮਿਲਦੀ ਹੈ ਅਤੇ ਬਾਕੀ 50% ਡਿਲਿਵਰੀ ਦੇ 24 ਘੰਟਿਆਂ ਵਿੱਚ ਸਿੱਧਾ ਤੁਹਾਡੇ ਬੈਂਕ/UPI ਖਾਤੇ ਵਿੱਚ ਆ ਜਾਂਦੀ ਹੈ।",
      hinglish: "AgriConnect par sabhi payments digital escrow se 100% secure hain. Order accept hone par buyer se 50% advance lock ho jata hai jo truck loading par release hota hai. Baki 50% balance weighbridge verification ke 24 ghante ke andar directly aapke bank account ya UPI me transfer ho jata hai.",
    },
  },
  {
    id: "fpo-pooling",
    chip: "FPO Aggregation / एकत्र विक्री",
    answer: {
      en: "FPO pooling lets small farmers combine lots into 10–20 tonne consignments. This unlocks bulk tier pricing (+₹2 to ₹3.50/kg higher) and cuts freight costs from ₹4.50/kg down to ₹1.80/kg through consolidated full-truck transport.",
      hi: "FPO एकत्रीकरण से छोटे किसान अपने लॉट जोड़कर 10–20 टन का माल तैयार कर सकते हैं। इससे बल्क टियर मूल्य (+₹2 से ₹3.50/किलो अधिक) मिलता है और ट्रक भाड़ा ₹4.50/किलो से घटकर मात्र ₹1.80/किलो रह जाता है।",
      mr: "FPO एकत्रिकरणाद्वारे छोटे शेतकरी आपले लॉट एकत्र करून 10–20 टनांची मोठी खेप तयार करू शकतात. यामुळे बल्क दर (+₹2 ते ₹3.50/किलो जास्त) मिळतो आणि वाहतूक खर्च ₹4.50/किलोवरून ₹1.80/किलोवर येतो.",
      pa: "FPO ਰਾਹੀਂ ਛੋਟੇ ਕਿਸਾਨ ਮਿਲ ਕੇ 10–20 ਟਨ ਦਾ ਮਾਲ ਤਿਆਰ ਕਰ ਸਕਦੇ ਹਨ। ਇਸ ਨਾਲ ਵੱਡੇ ਵਪਾਰੀਆਂ ਤੋਂ ਵੱਧ ਰੇਟ ਮਿਲਦਾ ਹੈ ਅਤੇ ਟਰਾਂਸਪੋਰਟ ਦਾ ਖਰਚਾ ਵੀ ਅੱਧਾ ਰਹਿ ਜਾਂਦਾ ਹੈ।",
      hinglish: "FPO aggregation se small farmers apne lots combine karke 10–20 tonne consignment bana sakte hain. Isse bulk buyer rates (+₹2 se ₹3.50/kg extra) milte hain aur shared full truck se freight cost ₹4.50/kg se girkar sirf ₹1.80/kg ho jati hai.",
    },
  },
];

export const BOT_GREETING: Record<SupportedBotLang, string> = {
  en: "Hello! I am your AgriConnect AI advisor. Ask me anything in English, Hindi, Marathi, Punjabi, or Hinglish about mandi rates, selling windows, storage, or payments.",
  hi: "नमस्ते! मैं आपका AgriConnect AI सलाहकार हूँ। महाराष्ट्र एवं आसपास की मंडियों के भाव, फसल बेचने का सही समय, कोल्ड स्टोरेज या पेमेंट के बारे में किसी भी भाषा में पूछें।",
  mr: "नमस्कार! मी तुमचा AgriConnect AI सहाय्यक आहे. बाजारभाव, विक्रीची योग्य वेळ, वाहतूक, शीतगृह किंवा पेमेंटबाबत मराठी, हिंदी किंवा इंग्रजीत प्रश्न विचारा.",
  pa: "ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ! ਮੈਂ ਤੁਹਾਡਾ AgriConnect AI ਸਹਾਇਕ ਹਾਂ। ਮੰਡੀ ਭਾਅ, ਫਸਲ ਵੇਚਣ ਦੇ ਸਹੀ ਸਮੇਂ, ਸਟੋਰੇਜ ਜਾਂ ਭੁਗਤਾਨ ਬਾਰੇ ਪੰਜਾਬੀ ਜਾਂ ਕਿਸੇ ਵੀ ਭਾਸ਼ਾ ਵਿੱਚ ਪੁੱਛੋ।",
  hinglish: "Namaste! Main aapka AgriConnect AI advisor hoon. Mandi rates, selling window, transport freight, cold storage ya payment ke bare me kuch bhi poochiye — main aapki hi language me jawab dunga!",
};

export const BOT_FALLBACK: Record<SupportedBotLang, string> = {
  en: "I understand your query. In the demo dataset, you can ask about live onion, tomato or soybean prices, best time to sell, cold storage costs, AI grading norms, or digital escrow payments.",
  hi: "मैं आपकी बात समझ गया। आप प्याज, टमाटर या सोयाबीन के लाइव मंडी भाव, बेचने का सही समय, कोल्ड स्टोरेज का खर्च, AI ग्रेडिंग या एस्क्रो पेमेंट के बारे में पूछ सकते हैं।",
  mr: "मला तुमचा प्रश्न समजला. डेमो डेटामध्ये तुम्ही कांदा, टोमॅटो किंवा सोयाबीनचे थेट बाजारभाव, विक्रीची योग्य वेळ, शीतगृह खर्च, AI ग्रेडिंग किंवा पेमेंटबाबत विचारू शकता.",
  pa: "ਮੈਨੂੰ ਤੁਹਾਡਾ ਸਵਾਲ ਸਮਝ ਆ ਗਿਆ ਹੈ। ਤੁਸੀਂ ਪਿਆਜ਼, ਟਮਾਟਰ, ਸੋਇਆਬੀਨ ਦੇ ਰੇਟ, ਵੇਚਣ ਦਾ ਸਹੀ ਸਮਾਂ, ਕੋਲਡ ਸਟੋਰੇਜ ਜਾਂ ਭੁਗਤਾਨ ਬਾਰੇ ਪੁੱਛ ਸਕਦੇ ਹੋ।",
  hinglish: "Mujhe aapka question samajh aa gaya. Demo database me aap pyaj, tamatar, soyabean ke live rates, bechne ka best time, cold storage cost, AI grading ya escrow payment ke bare me pooch sakte hain.",
};

