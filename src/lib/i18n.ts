export const locales = ["en", "fa"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

export function isLocale(v: string): v is Locale {
  return (locales as readonly string[]).includes(v);
}

export function dir(locale: Locale): "ltr" | "rtl" {
  return locale === "fa" ? "rtl" : "ltr";
}

const en = {
  brand: "PARSTECH SUPPLY",
  browseCatalog: "BROWSE CATALOG",
  search: "Search",
  searchPlaceholder: "Search",
  logIn: "Log in",
  emailUs: "Email Us",
  order: "ORDER",
  orderHistory: "ORDER HISTORY",
  allCategories: "All Categories",
  chooseCategory: "Choose a Category",
  filterBy: "Filter by",
  clearAll: "Clear all",
  products: "Products",
  productsLower: "products",
  addToOrder: "ADD TO ORDER",
  add: "Add",
  qty: "Qty",
  each: "Each",
  cart: "Order",
  home: "Home",
  about: "About",
  aboutPrefix: "About",
  partNumber: "Part No.",
  price: "Price",
  pkgQty: "Pkg. Qty.",
  pkg: "Pkg.",
  inStock: "In stock",
  madeToOrder: "Made to order",
  shipsIn: "Ships in",
  days: "days",
  weeks: "weeks",
  noResults: "No products match these filters.",
  clearFilters: "Clear filters",
  resultsFor: "Results for",
  didYouMean: "Categories",
  matchingParts: "Matching part numbers",
  viewAll: "View all",
  // Cart
  yourOrder: "Your Order",
  emptyCart: "Your order is empty.",
  startBrowsing: "Browse the catalog",
  remove: "Remove",
  update: "Update",
  subtotal: "Subtotal",
  lineTotal: "Total",
  unitPrice: "Unit Price",
  requestQuote: "REQUEST QUOTE",
  continueShopping: "Continue browsing",
  itemsInOrder: "items",
  // Quick order
  quickOrder: "Quick Order",
  quickOrderHelp:
    "Paste one part number per line, followed by a comma and the quantity. Example: 91290A115, 25",
  quickOrderPlaceholder: "91290A115, 25\n9452K12, 10",
  addAllToOrder: "ADD ALL TO ORDER",
  notFound: "Not found",
  added: "Added",
  // RFQ
  requestAQuote: "Request a Quote",
  rfqIntro:
    "Submit your requirements and our sales team will respond with pricing, availability and lead time.",
  company: "Company",
  contactName: "Contact name",
  email: "Email",
  phone: "Phone",
  poNumber: "PO number",
  address: "Delivery address",
  city: "City",
  country: "Country",
  notes: "Notes",
  optional: "optional",
  submitRequest: "SUBMIT REQUEST",
  quoteSubmitted: "Quote request received",
  quoteRef: "Your reference",
  quoteNext:
    "Our sales team will contact you. Keep this reference for correspondence.",
  backToCatalog: "Back to catalog",
  required: "This field is required",
  // Admin
  admin: "Admin",
  quoteRequests: "Quote Requests",
  password: "Password",
  signIn: "Sign in",
  signOut: "Sign out",
  wrongPassword: "Incorrect password",
  noQuotes: "No quote requests yet.",
  date: "Date",
  reference: "Reference",
  items: "Items",
  total: "Total",
  status: "Status",
  // Footer
  locations: "Locations",
  returns: "Returns",
  help: "Help",
  terms: "Terms and Conditions",
  footerNote: "By using this website, you agree to our Terms and Conditions.",
  seedNotice:
    "Demonstration catalog. Product data is generated for interface testing and must not be used to select a real part.",
};

/**
 * Persian (Farsi) strings. Technical identifiers — part numbers, dimensions —
 * deliberately stay in Latin digits even under RTL; Iranian procurement staff
 * match those against manufacturer catalogs, which are Latin.
 */
const fa: typeof en = {
  brand: "پارس‌تک ساپلای",
  browseCatalog: "مرور کاتالوگ",
  search: "جستجو",
  searchPlaceholder: "جستجو",
  logIn: "ورود",
  emailUs: "ارسال ایمیل",
  order: "سفارش",
  orderHistory: "سابقه سفارش‌ها",
  allCategories: "همه دسته‌بندی‌ها",
  chooseCategory: "انتخاب دسته‌بندی",
  filterBy: "فیلتر بر اساس",
  clearAll: "پاک کردن همه",
  products: "کالا",
  productsLower: "کالا",
  addToOrder: "افزودن به سفارش",
  add: "افزودن",
  qty: "تعداد",
  each: "هر عدد",
  cart: "سفارش",
  home: "خانه",
  about: "درباره",
  aboutPrefix: "درباره",
  partNumber: "کد کالا",
  price: "قیمت",
  pkgQty: "تعداد در بسته",
  pkg: "بسته",
  inStock: "موجود",
  madeToOrder: "ساخت سفارشی",
  shipsIn: "ارسال ظرف",
  days: "روز",
  weeks: "هفته",
  noResults: "کالایی با این فیلترها یافت نشد.",
  clearFilters: "حذف فیلترها",
  resultsFor: "نتایج برای",
  didYouMean: "دسته‌بندی‌ها",
  matchingParts: "کدهای کالای منطبق",
  viewAll: "مشاهده همه",
  yourOrder: "سفارش شما",
  emptyCart: "سفارش شما خالی است.",
  startBrowsing: "مرور کاتالوگ",
  remove: "حذف",
  update: "به‌روزرسانی",
  subtotal: "جمع جزء",
  lineTotal: "جمع",
  unitPrice: "قیمت واحد",
  requestQuote: "درخواست استعلام",
  continueShopping: "ادامه مرور",
  itemsInOrder: "قلم",
  quickOrder: "سفارش سریع",
  quickOrderHelp:
    "در هر سطر یک کد کالا وارد کنید، سپس ویرگول و تعداد. نمونه: ‎91290A115, 25",
  quickOrderPlaceholder: "91290A115, 25\n9452K12, 10",
  addAllToOrder: "افزودن همه به سفارش",
  notFound: "یافت نشد",
  added: "افزوده شد",
  requestAQuote: "درخواست استعلام قیمت",
  rfqIntro:
    "نیازمندی خود را ثبت کنید تا کارشناسان فروش قیمت، موجودی و زمان تحویل را اعلام کنند.",
  company: "نام شرکت",
  contactName: "نام تماس‌گیرنده",
  email: "ایمیل",
  phone: "تلفن",
  poNumber: "شماره سفارش خرید",
  address: "نشانی تحویل",
  city: "شهر",
  country: "کشور",
  notes: "توضیحات",
  optional: "اختیاری",
  submitRequest: "ثبت درخواست",
  quoteSubmitted: "درخواست استعلام ثبت شد",
  quoteRef: "شماره پیگیری",
  quoteNext:
    "کارشناسان فروش با شما تماس می‌گیرند. این شماره را برای پیگیری نگه دارید.",
  backToCatalog: "بازگشت به کاتالوگ",
  required: "تکمیل این فیلد الزامی است",
  admin: "مدیریت",
  quoteRequests: "درخواست‌های استعلام",
  password: "گذرواژه",
  signIn: "ورود",
  signOut: "خروج",
  wrongPassword: "گذرواژه نادرست است",
  noQuotes: "هنوز درخواستی ثبت نشده است.",
  date: "تاریخ",
  reference: "شماره پیگیری",
  items: "اقلام",
  total: "جمع کل",
  status: "وضعیت",
  locations: "شعب",
  returns: "مرجوعی",
  help: "راهنما",
  terms: "شرایط و مقررات",
  footerNote: "استفاده از این وب‌سایت به معنای پذیرش شرایط و مقررات است.",
  seedNotice:
    "کاتالوگ نمایشی. داده‌های کالا برای آزمایش رابط کاربری تولید شده و مبنای انتخاب قطعه واقعی نیست.",
};

export type Dict = typeof en;

const dictionaries: Record<Locale, Dict> = { en, fa };

export function getDict(locale: Locale): Dict {
  return dictionaries[locale] ?? dictionaries.en;
}

/** Picks the locale-appropriate field off a row carrying `<field>En` / `<field>Fa`. */
export function pick<T extends Record<string, unknown>>(
  row: T,
  base: string,
  locale: Locale,
): string {
  const key = locale === "fa" ? `${base}Fa` : `${base}En`;
  const val = row[key];
  if (typeof val === "string" && val.length > 0) return val;
  const fallback = row[`${base}En`];
  return typeof fallback === "string" ? fallback : "";
}
