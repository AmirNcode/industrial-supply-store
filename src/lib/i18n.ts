export const locales = ["en", "fa"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

export function isLocale(v: string): v is Locale {
  return (locales as readonly string[]).includes(v);
}

/**
 * Used by every action that redirects to a locale-prefixed path: the posted
 * `locale` value reaches `redirect()` unchanged, so a `locale` of `/evil.com`
 * would make that `//evil.com/admin` — a protocol-relative URL, and an open
 * redirect. Anything unrecognised falls back to English.
 */
export function safeLocale(formData: FormData): Locale {
  const raw = String(formData.get("locale") ?? "");
  return isLocale(raw) ? raw : "en";
}

export function dir(locale: Locale): "ltr" | "rtl" {
  return locale === "fa" ? "rtl" : "ltr";
}

/**
 * The same page in the other language.
 *
 * Every route is `/[locale]/…`, so switching language is swapping one segment.
 * The header used to link at `/fa` outright, which threw away whatever the
 * reader was looking at and dropped them back on the catalog — worst on the
 * pages where the switch is most useful, like a filtered family listing or an
 * invoice.
 *
 * A path with no recognised locale segment has nowhere better to go than that
 * language's home.
 */
export function swapLocale(pathname: string, to: Locale): string {
  const segments = pathname.split("/");
  if (segments.length > 1 && isLocale(segments[1])) {
    segments[1] = to;
    return segments.join("/");
  }
  return `/${to}`;
}

const en = {
  brand: "TEMEX",
  tagline: "Tools, Equipment & Materials Express",
  brandPromise:
    "Quality tools, equipment and materials, delivered fast — with a money-back guarantee on everything we sell.",
  catalogButton: "Catalog",
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
  inCart: "In Cart",
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
  viewAs: "View as",
  viewAsCategories: "Product categories",
  viewAsList: "List of products",
  filterApplied: "filter applied",
  filtersApplied: "filters applied",
  noFiltersApplied: "No filters applied",
  viewProducts: "View",
  done: "Done",
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
  quoteRequests: "Orders",
  password: "Password",
  signIn: "Sign in",
  signOut: "Sign out",
  wrongPassword: "Incorrect password",
  noQuotes: "No orders yet.",
  date: "Date",
  reference: "Reference",
  items: "Items",
  total: "Total",
  status: "Status",
  // Order statuses
  statusReceived: "Received",
  statusInvoiced: "Awaiting payment",
  statusPreparing: "Preparing for shipment",
  statusShipped: "Shipped",
  statusDelivered: "Delivered",
  statusCancelled: "Cancelled",
  // Admin order actions
  markPaid: "Mark payment received",
  markShipped: "Mark shipped",
  markDelivered: "Mark delivered",
  cancelOrder: "Cancel order",
  courier: "Courier",
  trackingNumber: "Tracking number",
  allOrders: "All",
  needsAction: "Needs action",
  trackingRequired: "Enter both a courier and a tracking number.",
  // Invoicing
  issueInvoice: "Issue invoice",
  paymentLink: "Payment link",
  invoiceNumber: "Invoice no.",
  finalUnitPrice: "Final price",
  paymentLinkRequired: "A payment link is required to issue an invoice.",
  pricesRequired: "Every line needs a price of at least zero.",
  // Action feedback
  orderUpdated: "Order updated.",
  invoiceIssued: "Invoice issued.",
  orderNotFound: "That order no longer exists.",
  orderConflict: "That order changed while you were working on it. Check its current status and try again.",
  badRequest: "That request could not be understood.",
  // Footer
  locations: "Locations",
  returns: "Returns",
  help: "Help",
  terms: "Terms and Conditions",
  footerNote: "By using this website, you agree to our Terms and Conditions.",
  seedNotice:
    "Demonstration catalog. Product data is generated for interface testing and must not be used to select a real part.",
  // Demo mode
  demoBanner:
    "DEMO — sample data. Quote requests submitted here are publicly visible.",
  demoAdminPublic:
    "Public demo view — no sign-in required. Anyone with this link can read these requests.",
  demoQuoteWarning:
    "This is a public demo. Anything you submit here can be read by anyone — please do not enter real contact details.",
  // Exchange rate
  exchangeRate: "Exchange rate",
  fxAutomatic: "Automatic",
  fxManual: "Manual",
  fxPerUsd: "Toman / USD",
  fxFromEnv: "from USD_TO_TOMAN",
  fxApply: "Apply",
  fxConfirm: "Confirm",
  fxCancel: "Cancel",
  fxConfirmPrompt: "Apply this rate?",
  fxAppliesTo:
    "Applies to displayed prices. Invoices keep the rate frozen when they are issued.",
  fxOutOfRange:
    "That rate is more than ten times away from the automatic rate. Check for a stray digit.",
  fxInvalid: "Enter a whole number of Toman.",
  // Invoice
  invoice: "Invoice",
  invoiceTo: "Bill to",
  invoiceFrom: "From",
  invoiceDate: "Date",
  invoiceOrderRef: "Order reference",
  invoiceDescription: "Description",
  invoiceLineTotal: "Amount",
  invoiceSubtotal: "Subtotal",
  invoiceTotal: "Total due",
  invoicePay: "Pay online",
  invoiceDownload: "Download PDF",
  invoiceTaxId: "Tax ID",
  invoiceFxNote:
    "Converted from US dollars at the rate in force when this invoice was issued.",
  invoiceThanks: "Thank you for your business.",
  // Account
  account: "Account",
  signUp: "Create account",
  signInTitle: "Sign in",
  signUpTitle: "Create an account",
  signInPrompt: "Sign in to see your orders and invoices.",
  signUpPrompt: "Create an account to track your orders and download invoices.",
  haveAccount: "Already have an account?",
  needAccount: "Need an account?",
  passwordAgain: "Confirm password",
  signInFailed: "Email or password is incorrect.",
  emailTaken: "An account with that email already exists.",
  passwordTooShort: "Use at least 8 characters.",
  passwordMismatch: "The two passwords do not match.",
  signUpIncomplete: "Fill in every required field.",
  myOrders: "My orders",
  profile: "Profile",
  saveProfile: "Save profile",
  profileSaved: "Profile saved.",
  defaultPoNumber: "Default PO number",
  noOrdersYet: "No orders yet.",
  orderPlaced: "Placed",
  viewOrder: "View",
  viewInvoice: "View invoice",
  payNow: "Pay now",
  signedInAs: "Signed in as",
  resetPassword: "Reset password",
  newPasswordOnce: "New password — copy it now, it will not be shown again:",
  noAccountForEmail: "No account exists for that email address.",
  invoiceCancelled: "CANCELLED — this invoice is void and must not be paid.",
  invoiceVoid: "Not payable",
  profileSettings: "Profile settings",
  invoiceCurrency: "Currency",
  settings: "Settings",
  confirmContinue: "Continue",
  confirmDiscard: "Discard",
  confirmIssueInvoice: "Issue this invoice?",
  confirmMarkPaid: "Record payment received?",
  confirmMarkShipped: "Mark this order shipped?",
  confirmMarkDelivered: "Mark this order delivered?",
  confirmCancelOrder: "Cancel this order?",
  confirmSendingTo: "Customer",
  confirmOrder: "Order",
  confirmNewStatus: "New status",
  confirmInvoiceTotal: "Invoice total",
  internalNotes: "Internal notes",
  internalNotesHint: "Staff only. Never shown to the customer.",
  addNote: "Add note",
  noNotesYet: "No notes yet.",
  noteAdded: "Note added.",
  changePassword: "Change password",
  currentPassword: "Current password",
  newPassword: "New password",
  passwordChanged: "Password changed.",
  currentPasswordWrong: "Current password is incorrect.",
  languagePreference: "Language",
  languageHint:
    "Where you land after signing in. You can still switch language on any page.",
  english: "English",
  persian: "Persian",
  // Guest tracking
  trackOrder: "Track an order",
  trackIntro:
    "Enter your order reference and the email address you used. Both must match.",
  trackRefLabel: "Order reference",
  trackSubmit: "Find order",
  trackNotFound: "No order found with that reference and email address.",
  trackCourier: "Courier",
  trackNoTracking: "No tracking number yet.",
  trackHaveAccount:
    "With an account you can see prices, invoices and every order in one place.",
  trackFromSubmitted: "You can check on it any time from the tracking page.",
  // Import
  importProducts: "Import products",
  importIntro:
    "Download a family's template or its current products, edit in Excel, and upload the same file back. Nothing is written unless every row is valid.",
  downloadTemplate: "Template",
  exportProducts: "Export",
  uploadCsv: "Upload CSV",
  importSummary: "Imported: {inserted} new, {updated} updated.",
  importNothingWritten: "Nothing was imported. Fix these and upload again:",
  importRow: "Row",
  importColumn: "Column",
  importProblem: "Problem",
  importTooLarge: "That file is too large. The limit is 2 MB and 5,000 rows.",
  importNoFile: "Choose a CSV file first.",
  importFamilyGone: "That family no longer exists.",
  importWrongFamily:
    "These part numbers already belong to a different family, so nothing was imported:",
  importCaseVariant:
    "These part numbers already exist with different capitalisation. Use the catalog's spelling exactly, or nothing will match:",
  importInventoryMismatch:
    "Imported, but these on-hold or sold counts disagree with what the orders say:",
  importFromOrders: "from orders",
  stockAvailable: "Available",
  stockOnHold: "On hold",
  stockSold: "Sold",
  stockShortfall: "Not enough stock for:",
  importReadOnly: "Importing is disabled in demo mode.",
};

/**
 * Persian (Farsi) strings. Technical identifiers — part numbers, dimensions —
 * deliberately stay in Latin digits even under RTL; Iranian procurement staff
 * match those against manufacturer catalogs, which are Latin.
 */
const fa: typeof en = {
  brand: "TEMEX",
  tagline: "ابزار، تجهیزات و مواد اکسپرس",
  brandPromise:
    "ابزار، تجهیزات و مواد باکیفیت، با ارسال سریع — و ضمانت بازگشت وجه روی تمام کالاها.",
  catalogButton: "کاتالوگ",
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
  inCart: "در سفارش",
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
  viewAs: "نمایش به‌صورت",
  viewAsCategories: "دسته‌بندی کالاها",
  viewAsList: "فهرست کالاها",
  // Persian does not inflect the noun after a number, so both forms match.
  filterApplied: "فیلتر اعمال شده",
  filtersApplied: "فیلتر اعمال شده",
  noFiltersApplied: "بدون فیلتر",
  viewProducts: "نمایش",
  done: "تأیید",
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
  quoteRequests: "سفارش‌ها",
  password: "گذرواژه",
  signIn: "ورود",
  signOut: "خروج",
  wrongPassword: "گذرواژه نادرست است",
  noQuotes: "هنوز سفارشی ثبت نشده است.",
  date: "تاریخ",
  reference: "شماره پیگیری",
  items: "اقلام",
  total: "جمع کل",
  status: "وضعیت",
  statusReceived: "دریافت شد",
  statusInvoiced: "در انتظار پرداخت",
  statusPreparing: "در حال آماده‌سازی",
  statusShipped: "ارسال شد",
  statusDelivered: "تحویل داده شد",
  statusCancelled: "لغو شد",
  markPaid: "ثبت دریافت وجه",
  markShipped: "ثبت ارسال",
  markDelivered: "ثبت تحویل",
  cancelOrder: "لغو سفارش",
  courier: "شرکت حمل",
  trackingNumber: "کد رهگیری",
  allOrders: "همه",
  needsAction: "نیازمند اقدام",
  trackingRequired: "نام شرکت حمل و کد رهگیری هر دو الزامی است.",
  issueInvoice: "صدور صورتحساب",
  paymentLink: "لینک پرداخت",
  invoiceNumber: "شماره صورتحساب",
  finalUnitPrice: "قیمت نهایی",
  paymentLinkRequired: "برای صدور صورتحساب، لینک پرداخت الزامی است.",
  pricesRequired: "برای همه ردیف‌ها باید قیمت وارد شود.",
  orderUpdated: "سفارش به‌روزرسانی شد.",
  invoiceIssued: "صورتحساب صادر شد.",
  orderNotFound: "این سفارش دیگر وجود ندارد.",
  orderConflict: "وضعیت این سفارش در حین کار شما تغییر کرد. وضعیت فعلی را بررسی و دوباره تلاش کنید.",
  badRequest: "این درخواست قابل پردازش نبود.",
  locations: "شعب",
  returns: "مرجوعی",
  help: "راهنما",
  terms: "شرایط و مقررات",
  footerNote: "استفاده از این وب‌سایت به معنای پذیرش شرایط و مقررات است.",
  seedNotice:
    "کاتالوگ نمایشی. داده‌های کالا برای آزمایش رابط کاربری تولید شده و مبنای انتخاب قطعه واقعی نیست.",
  demoBanner:
    "نسخه نمایشی — داده‌های نمونه. درخواست‌های استعلام ثبت‌شده برای عموم قابل مشاهده است.",
  demoAdminPublic:
    "نمای عمومی نسخه نمایشی — بدون نیاز به ورود. هر کسی با این لینک می‌تواند این درخواست‌ها را ببیند.",
  demoQuoteWarning:
    "این یک نسخه نمایشی عمومی است. هر آنچه ثبت کنید برای دیگران قابل مشاهده خواهد بود — لطفاً اطلاعات تماس واقعی وارد نکنید.",
  exchangeRate: "نرخ ارز",
  fxAutomatic: "خودکار",
  fxManual: "دستی",
  fxPerUsd: "تومان به ازای هر دلار",
  fxFromEnv: "از USD_TO_TOMAN",
  fxApply: "اعمال",
  fxConfirm: "تأیید",
  fxCancel: "انصراف",
  fxConfirmPrompt: "این نرخ اعمال شود؟",
  fxAppliesTo:
    "روی قیمت‌های نمایش‌داده‌شده اعمال می‌شود. نرخ صورتحساب‌ها هنگام صدور ثابت می‌ماند.",
  fxOutOfRange:
    "این نرخ بیش از ده برابر با نرخ خودکار فاصله دارد. رقم اضافه را بررسی کنید.",
  fxInvalid: "یک عدد صحیح به تومان وارد کنید.",
  invoice: "صورتحساب",
  invoiceTo: "صورتحساب برای",
  invoiceFrom: "از طرف",
  invoiceDate: "تاریخ",
  invoiceOrderRef: "شماره سفارش",
  invoiceDescription: "شرح کالا",
  invoiceLineTotal: "مبلغ",
  invoiceSubtotal: "جمع جزء",
  invoiceTotal: "مبلغ قابل پرداخت",
  invoicePay: "پرداخت آنلاین",
  invoiceDownload: "دریافت PDF",
  invoiceTaxId: "شناسه مالیاتی",
  invoiceFxNote:
    "مبالغ از دلار آمریکا و با نرخ زمان صدور این صورتحساب تبدیل شده است.",
  invoiceThanks: "از خرید شما سپاسگزاریم.",
  account: "حساب کاربری",
  signUp: "ایجاد حساب",
  signInTitle: "ورود",
  signUpTitle: "ایجاد حساب کاربری",
  signInPrompt: "برای مشاهده سفارش‌ها و صورتحساب‌ها وارد شوید.",
  signUpPrompt: "برای پیگیری سفارش‌ها و دریافت صورتحساب حساب بسازید.",
  haveAccount: "قبلاً حساب ساخته‌اید؟",
  needAccount: "حساب ندارید؟",
  passwordAgain: "تکرار گذرواژه",
  signInFailed: "ایمیل یا گذرواژه نادرست است.",
  emailTaken: "حسابی با این ایمیل از قبل وجود دارد.",
  passwordTooShort: "حداقل ۸ نویسه وارد کنید.",
  passwordMismatch: "دو گذرواژه یکسان نیستند.",
  signUpIncomplete: "همه فیلدهای الزامی را تکمیل کنید.",
  myOrders: "سفارش‌های من",
  profile: "مشخصات",
  saveProfile: "ذخیره مشخصات",
  profileSaved: "مشخصات ذخیره شد.",
  defaultPoNumber: "شماره سفارش خرید پیش‌فرض",
  noOrdersYet: "هنوز سفارشی ثبت نشده است.",
  orderPlaced: "تاریخ ثبت",
  viewOrder: "مشاهده",
  viewInvoice: "مشاهده صورتحساب",
  payNow: "پرداخت",
  signedInAs: "واردشده با",
  resetPassword: "بازنشانی گذرواژه",
  newPasswordOnce: "گذرواژه جدید — همین حالا کپی کنید، دوباره نمایش داده نمی‌شود:",
  noAccountForEmail: "حسابی با این ایمیل وجود ندارد.",
  invoiceCancelled: "لغو شده — این صورتحساب باطل است و نباید پرداخت شود.",
  invoiceVoid: "قابل پرداخت نیست",
  profileSettings: "تنظیمات حساب",
  invoiceCurrency: "واحد پول",
  settings: "تنظیمات",
  confirmContinue: "ادامه",
  confirmDiscard: "انصراف",
  confirmIssueInvoice: "این صورتحساب صادر شود؟",
  confirmMarkPaid: "دریافت وجه ثبت شود؟",
  confirmMarkShipped: "این سفارش ارسال‌شده علامت بخورد؟",
  confirmMarkDelivered: "این سفارش تحویل‌شده علامت بخورد؟",
  confirmCancelOrder: "این سفارش لغو شود؟",
  confirmSendingTo: "مشتری",
  confirmOrder: "سفارش",
  confirmNewStatus: "وضعیت جدید",
  confirmInvoiceTotal: "مبلغ صورتحساب",
  internalNotes: "یادداشت‌های داخلی",
  internalNotesHint: "فقط برای کارکنان. هرگز به مشتری نشان داده نمی‌شود.",
  addNote: "افزودن یادداشت",
  noNotesYet: "هنوز یادداشتی ثبت نشده است.",
  noteAdded: "یادداشت ثبت شد.",
  changePassword: "تغییر گذرواژه",
  currentPassword: "گذرواژه فعلی",
  newPassword: "گذرواژه جدید",
  passwordChanged: "گذرواژه تغییر کرد.",
  currentPasswordWrong: "گذرواژه فعلی نادرست است.",
  languagePreference: "زبان",
  languageHint:
    "زبانی که پس از ورود به آن هدایت می‌شوید. در هر صفحه می‌توانید زبان را تغییر دهید.",
  english: "انگلیسی",
  persian: "فارسی",
  // Guest tracking
  trackOrder: "پیگیری سفارش",
  trackIntro:
    "شماره سفارش و ایمیلی که با آن ثبت کرده‌اید را وارد کنید. هر دو باید مطابقت داشته باشند.",
  trackRefLabel: "شماره سفارش",
  trackSubmit: "جستجوی سفارش",
  trackNotFound: "سفارشی با این شماره و ایمیل یافت نشد.",
  trackCourier: "شرکت حمل",
  trackNoTracking: "هنوز کد رهگیری ثبت نشده است.",
  trackHaveAccount:
    "با ساخت حساب کاربری می‌توانید قیمت‌ها، صورتحساب‌ها و همه سفارش‌ها را یکجا ببینید.",
  trackFromSubmitted: "هر زمان می‌توانید از صفحه پیگیری وضعیت آن را ببینید.",
  // Import
  importProducts: "بارگذاری گروهی کالا",
  importIntro:
    "قالب یک خانواده یا کالاهای فعلی آن را دریافت کنید، در اکسل ویرایش کنید و همان فایل را بارگذاری کنید. تا وقتی همه سطرها معتبر نباشند چیزی ثبت نمی‌شود.",
  downloadTemplate: "قالب",
  exportProducts: "خروجی",
  uploadCsv: "بارگذاری فایل CSV",
  importSummary: "بارگذاری شد: {inserted} کالای جدید، {updated} به‌روزرسانی.",
  importNothingWritten: "هیچ داده‌ای ثبت نشد. موارد زیر را اصلاح و دوباره بارگذاری کنید:",
  importRow: "سطر",
  importColumn: "ستون",
  importProblem: "اشکال",
  importTooLarge: "حجم فایل بیش از حد مجاز است. حداکثر ۲ مگابایت و ۵٬۰۰۰ سطر.",
  importNoFile: "ابتدا یک فایل CSV انتخاب کنید.",
  importFamilyGone: "این خانواده دیگر وجود ندارد.",
  importWrongFamily:
    "این شماره فنی‌ها به خانواده دیگری تعلق دارند، بنابراین چیزی ثبت نشد:",
  importCaseVariant:
    "این شماره فنی‌ها با حروف بزرگ و کوچک متفاوت از قبل وجود دارند. دقیقاً از املای موجود در کاتالوگ استفاده کنید:",
  importInventoryMismatch:
    "ثبت شد، اما این مقادیر رزرو یا فروش با سفارش‌ها همخوانی ندارد:",
  importFromOrders: "طبق سفارش‌ها",
  stockAvailable: "موجودی",
  stockOnHold: "رزرو شده",
  stockSold: "فروخته شده",
  stockShortfall: "موجودی کافی نیست برای:",
  importReadOnly: "بارگذاری در حالت نمایشی غیرفعال است.",
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
