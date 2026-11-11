/**
 * The words added with instant checkout (2026-11): cart, checkout, the
 * pish-factor, quotes, deadlines, saved addresses, sign-in codes, the email
 * log. Spread into the main dictionaries in `i18n.ts`, so `t.checkout` works
 * like any other key. Kept apart only because that file is already 1,900
 * lines; the rule is the same — `checkoutFa` is typed as `typeof checkoutEn`,
 * so a missing Persian key is a compile error.
 *
 * `{name}` placeholders are filled with `.replace("{name}", …)` at the call
 * site, as elsewhere.
 */
export const checkoutEn = {
  // Cart
  checkout: "CHECKOUT",
  cartRequestQuoteCell: "Request quote",
  cartStockSplit: "Only {now} in stock — the other {later} need a quote",
  cartOutOfStock: "Out of stock — needs a quote for price and delivery time",
  cartNoPrice: "No list price — needs a quote",
  cartSupplierItem: "Not kept in stock, supplied to order — needs a quote for price and delivery time",
  cartQuoteOnlyNote:
    "Nothing in this order can be bought straight away, so it goes to our sales team for a quote. There is nothing to pay until you accept the quote.",
  cartVatNote: "Prices exclude VAT. VAT is added at checkout.",
  cartNeedsQuoteNote:
    "Some items need a quote. At checkout you can pay now for what is in stock, or wait and pay for everything together.",
  cartCheckoutNote: "Place the order to get your pro forma invoice with bank details straight away.",

  // Checkout page
  checkoutTitle: "Checkout",
  checkoutIntroInstant:
    "Place the order and your pro forma invoice (pish-factor) with our bank details appears immediately. You then have 24 hours to pay and upload the receipt.",
  checkoutIntroQuote:
    "These items need our sales team to confirm price and lead time. Send the request and we will email your quote within 5 days. There is nothing to pay yet.",
  checkoutIntroMixed:
    "Part of this order can be paid for now; the rest needs a quote. Choose below how you would like to proceed.",
  checkoutPayNowHeading: "Ready to pay now",
  checkoutQuoteHeading: "Waiting for a quote",
  checkoutVat: "VAT ({rate})",
  checkoutTotalDue: "Total due",
  checkoutQuoteListTotal: "List total, to be confirmed",
  checkoutUnpricedNote: "Includes items with no list price yet.",
  checkoutModeLegend: "How would you like to proceed?",
  checkoutModeSplit: "Pay now for the in-stock items, and get a quote for the rest",
  checkoutModeSplitHint: "Two orders: a pro forma invoice now, and a quote within 5 days.",
  checkoutModeTogether: "Wait for the quote and pay for everything together",
  checkoutModeTogetherHint: "In-stock items are held for you for up to 5 days while we prepare the quote.",
  backorderTag: "Not in stock — supplied to order",
  awaitingQuoteTag: "No list price — awaiting quote",
  backorderExplain:
    "Items marked “Not in stock” are supplied to order: our quote confirms their price and delivery time before you pay.",
  deliveryHeading: "Delivery address",
  postalCode: "Postal code",
  addressChoiceNew: "A different address",
  saveAddressLabel: "Save this address to my account",
  taxHeading: "Company tax details",
  taxHint: "Printed on the official invoice. Optional.",
  nationalId: "National ID",
  economicCode: "Economic code",
  placeOrder: "PLACE ORDER",
  checkoutAccountNote:
    "We will create an account from these details so you can follow your order. No password is needed now.",
  checkoutStockChanged:
    "Prices or stock changed while this page was open. Please review the order below and submit again.",
  deliveryRequired: "Company, name, phone, address and city are required.",

  // Order status, pay page, documents
  statusQuoted: "Quote ready",
  payPlacedPish:
    "Order placed. Pay by bank transfer to the account below and upload the receipt before the deadline.",
  payPlacedQuote: "Request received. We will email your quote within 5 days.",
  payQuoteReady: "Your quote is ready. Accept it to receive the pro forma invoice and pay.",
  acceptQuote: "ACCEPT QUOTE",
  acceptQuoteNote:
    "Accepting issues the pro forma invoice at today's exchange rate. You then have 24 hours to pay.",
  quoteAccepted: "Quote accepted. Your pro forma invoice is ready.",
  acceptFailed: "The quote could not be accepted. It may have lapsed — please contact us.",
  payDeadline: "Pay by {time}",
  timeLeft: "{time} left",
  quoteValidUntil: "Quote valid until {time}",
  quoteDueBy: "We will send your quote by {time}",
  countdownHoursMinutes: "{h} h {m} min",
  countdownDaysHours: "{d} d {h} h",
  payExpired:
    "This order expired: nothing arrived before the deadline, so it was cancelled and the goods were released. You are welcome to order again.",
  statusExpired: "Expired",
  viewPishFactor: "View pro forma invoice",
  pishFactorTitle: "PRO FORMA INVOICE",
  pishFactorNote:
    "This is not an official invoice. The official numbered invoice is issued when payment is confirmed.",
  pishFactorValidUntil: "Valid until",
  siblingOrder: "Placed together with {ref}",
  orderDeadline: "Deadline",

  // Account
  accountNumber: "Account number",
  accountNumberHint: "Give this number to your sales rep to place orders for you.",
  addressesHeading: "Delivery addresses",
  addAddress: "Add address",
  addressLabel: "Name for this address",
  addressLabelHint: "For example: Karaj warehouse",
  recipient: "Recipient",
  defaultAddress: "Default",
  makeDefault: "Make default",
  editAddress: "Edit",
  deleteAddress: "Delete",
  addressSaved: "Addresses updated.",
  addressInvalid: "Address and city are required.",
  addressFull: "You can save up to 20 addresses.",
  noAddresses: "No saved addresses yet.",
  reorder: "Reorder",
  awaitingPaymentHeading: "Awaiting payment",
  quotesWaitingHeading: "Quotes waiting for you",
  payNow: "Pay / upload receipt",

  // Sign-in and sign-up
  signInContinue: "Continue",
  signInUseCode: "Email me a sign-in code instead",
  signInForgot: "Forgot your password?",
  signInChangeLogin: "Use a different email or account number",
  signInCodeTitle: "Enter your code",
  signInCodePrompt:
    "If that address has an account, we have emailed it a 6-digit code. The code is valid for 10 minutes.",
  signInCodeLabel: "6-digit code",
  signInCodeWrong: "That code is not right.",
  signInCodeExpired: "That code has expired or was tried too many times. Send a new one.",
  signInCodeResend: "Send a new code",
  signInCodeSent: "A new code is on its way.",
  firstPasswordTitle: "Choose your password",
  firstPasswordPrompt: "Your email is confirmed. Choose a password to sign in with next time.",
  signUpNoPasswordNote:
    "No password yet: we email a code to confirm your address, and then you choose one.",
  accountNumberChoice: "Your account number",
  accountNumberPhone: "Use the last 7 digits of my phone number",
  accountNumberAssigned: "Assign me a number",

  // Admin and rep
  sendQuote: "Send quote",
  quoteSentOk: "Quote sent to the customer.",
  acceptForCustomer: "Customer accepted — issue pro forma",
  holdReleased: "Stock hold released",
  adminEmails: "Emails",
  emailLogTitle: "Emails",
  emailLogEmpty: "No emails yet.",
  emailLoggedNote:
    "No email provider key is set, so messages are recorded here instead of being sent.",
  emailTo: "To",
  emailSubject: "Subject",
  emailKind: "Type",
  emailWhen: "When",
  emailStatus: "Status",
  emailStatusSent: "Sent",
  emailStatusLogged: "Not sent (recorded)",
  emailStatusFailed: "Failed",
  emailShowBody: "Show message",
  quoteDraftNotice:
    "Draft quote — nothing has been sent yet. Check every line, the VAT and the total, then send. The customer receives the quote by email and has 5 days to accept it. The rial amount is fixed at the exchange rate and VAT rate of the day they accept, and the invoice number is assigned when payment is confirmed.",
  confirmSendQuote: "Send this quote to the customer?",
};

export const checkoutFa: typeof checkoutEn = {
  // Cart
  checkout: "ثبت و تسویه سفارش",
  cartRequestQuoteCell: "استعلام قیمت",
  cartStockSplit: "فقط {now} عدد موجود است — {later} عدد دیگر نیاز به استعلام دارد",
  cartOutOfStock: "ناموجود — قیمت و زمان تحویل با استعلام مشخص می‌شود",
  cartNoPrice: "بدون قیمت فهرست — نیاز به استعلام",
  cartSupplierItem: "در انبار نگهداری نمی‌شود و سفارشی تأمین می‌شود — قیمت و زمان تحویل با استعلام",
  cartQuoteOnlyNote:
    "هیچ‌یک از اقلام این سفارش را نمی‌توان بلافاصله خرید؛ سفارش برای استعلام به کارشناسان فروش ارسال می‌شود. تا زمانی که استعلام را تأیید نکنید، نیازی به پرداخت نیست.",
  cartVatNote: "قیمت‌ها بدون مالیات بر ارزش افزوده است و مالیات هنگام تسویه اضافه می‌شود.",
  cartNeedsQuoteNote:
    "برخی اقلام نیاز به استعلام دارند. هنگام تسویه می‌توانید اقلام موجود را همین حالا پرداخت کنید یا منتظر استعلام بمانید و همه را یک‌جا بپردازید.",
  cartCheckoutNote: "با ثبت سفارش، پیش‌فاکتور همراه با اطلاعات حساب بانکی بلافاصله صادر می‌شود.",

  // Checkout page
  checkoutTitle: "تسویه حساب",
  checkoutIntroInstant:
    "با ثبت سفارش، پیش‌فاکتور همراه با اطلاعات حساب بانکی ما بلافاصله نمایش داده می‌شود. پس از آن ۲۴ ساعت فرصت دارید پرداخت کنید و رسید را بارگذاری نمایید.",
  checkoutIntroQuote:
    "قیمت و زمان تحویل این اقلام باید توسط کارشناسان فروش تأیید شود. درخواست را ثبت کنید؛ استعلام حداکثر تا ۵ روز برای شما ایمیل می‌شود. فعلاً نیازی به پرداخت نیست.",
  checkoutIntroMixed:
    "بخشی از این سفارش را می‌توان همین حالا پرداخت کرد و بقیه نیاز به استعلام دارد. نحوه ادامه را در پایین انتخاب کنید.",
  checkoutPayNowHeading: "آماده پرداخت",
  checkoutQuoteHeading: "در انتظار استعلام",
  checkoutVat: "مالیات بر ارزش افزوده ({rate})",
  checkoutTotalDue: "مبلغ قابل پرداخت",
  checkoutQuoteListTotal: "جمع بر اساس قیمت فهرست (نیاز به تأیید)",
  checkoutUnpricedNote: "شامل اقلامی که هنوز قیمت فهرست ندارند.",
  checkoutModeLegend: "چگونه ادامه می‌دهید؟",
  checkoutModeSplit: "اقلام موجود را همین حالا پرداخت می‌کنم و برای بقیه استعلام می‌گیرم",
  checkoutModeSplitHint: "دو سفارش: یک پیش‌فاکتور همین حالا، و یک استعلام تا ۵ روز آینده.",
  checkoutModeTogether: "منتظر استعلام می‌مانم و همه را یک‌جا پرداخت می‌کنم",
  checkoutModeTogetherHint: "اقلام موجود تا ۵ روز، در مدت آماده‌شدن استعلام، برای شما نگه داشته می‌شود.",
  backorderTag: "ناموجود — تأمین سفارشی",
  awaitingQuoteTag: "بدون قیمت فهرست — در انتظار استعلام",
  backorderExplain:
    "اقلامی که با «ناموجود» مشخص شده‌اند سفارشی تأمین می‌شوند: قیمت و زمان تحویل آن‌ها پیش از پرداخت در استعلام تأیید می‌شود.",
  deliveryHeading: "نشانی تحویل",
  postalCode: "کد پستی",
  addressChoiceNew: "نشانی دیگر",
  saveAddressLabel: "این نشانی در حساب من ذخیره شود",
  taxHeading: "اطلاعات مالیاتی شرکت",
  taxHint: "روی فاکتور رسمی چاپ می‌شود. اختیاری است.",
  nationalId: "شناسه ملی",
  economicCode: "کد اقتصادی",
  placeOrder: "ثبت سفارش",
  checkoutAccountNote:
    "با همین اطلاعات برای شما حساب کاربری ساخته می‌شود تا بتوانید سفارش را پیگیری کنید. فعلاً نیازی به رمز عبور نیست.",
  checkoutStockChanged:
    "در مدتی که این صفحه باز بود، قیمت یا موجودی تغییر کرد. لطفاً سفارش را دوباره بررسی و ثبت کنید.",
  deliveryRequired: "نام شرکت، نام، تلفن، نشانی و شهر الزامی است.",

  // Order status, pay page, documents
  statusQuoted: "استعلام آماده است",
  payPlacedPish:
    "سفارش ثبت شد. مبلغ را به حساب زیر واریز کنید و پیش از پایان مهلت، رسید را بارگذاری نمایید.",
  payPlacedQuote: "درخواست شما دریافت شد. استعلام حداکثر تا ۵ روز برای شما ایمیل می‌شود.",
  payQuoteReady: "استعلام شما آماده است. با تأیید آن، پیش‌فاکتور صادر می‌شود و می‌توانید پرداخت کنید.",
  acceptQuote: "تأیید استعلام",
  acceptQuoteNote:
    "با تأیید، پیش‌فاکتور با نرخ ارز امروز صادر می‌شود و پس از آن ۲۴ ساعت برای پرداخت فرصت دارید.",
  quoteAccepted: "استعلام تأیید شد. پیش‌فاکتور شما آماده است.",
  acceptFailed: "تأیید استعلام ممکن نشد. شاید اعتبار آن گذشته باشد — لطفاً با ما تماس بگیرید.",
  payDeadline: "مهلت پرداخت: {time}",
  timeLeft: "{time} باقی مانده",
  quoteValidUntil: "اعتبار استعلام تا {time}",
  quoteDueBy: "استعلام تا {time} برای شما ارسال می‌شود",
  countdownHoursMinutes: "{h} ساعت و {m} دقیقه",
  countdownDaysHours: "{d} روز و {h} ساعت",
  payExpired:
    "این سفارش منقضی شد: تا پایان مهلت چیزی دریافت نشد، بنابراین سفارش لغو و کالا آزاد شد. می‌توانید دوباره سفارش دهید.",
  statusExpired: "منقضی شد",
  viewPishFactor: "مشاهده پیش‌فاکتور",
  pishFactorTitle: "پیش‌فاکتور",
  pishFactorNote: "این سند فاکتور رسمی نیست. فاکتور رسمی شماره‌دار پس از تأیید پرداخت صادر می‌شود.",
  pishFactorValidUntil: "معتبر تا",
  siblingOrder: "هم‌زمان با سفارش {ref} ثبت شده است",
  orderDeadline: "مهلت",

  // Account
  accountNumber: "شماره حساب مشتری",
  accountNumberHint: "برای ثبت سفارش توسط کارشناس فروش، این شماره را به او بدهید.",
  addressesHeading: "نشانی‌های تحویل",
  addAddress: "افزودن نشانی",
  addressLabel: "نام این نشانی",
  addressLabelHint: "مثلاً: انبار کرج",
  recipient: "تحویل‌گیرنده",
  defaultAddress: "پیش‌فرض",
  makeDefault: "انتخاب به‌عنوان پیش‌فرض",
  editAddress: "ویرایش",
  deleteAddress: "حذف",
  addressSaved: "نشانی‌ها به‌روز شد.",
  addressInvalid: "نشانی و شهر الزامی است.",
  addressFull: "حداکثر ۲۰ نشانی قابل ذخیره است.",
  noAddresses: "هنوز نشانی ذخیره‌شده‌ای ندارید.",
  reorder: "سفارش مجدد",
  awaitingPaymentHeading: "در انتظار پرداخت",
  quotesWaitingHeading: "استعلام‌های آماده تأیید",
  payNow: "پرداخت / بارگذاری رسید",

  // Sign-in and sign-up
  signInContinue: "ادامه",
  signInUseCode: "کد ورود برایم ایمیل شود",
  signInForgot: "رمز عبور را فراموش کرده‌اید؟",
  signInChangeLogin: "استفاده از ایمیل یا شماره حساب دیگر",
  signInCodeTitle: "کد را وارد کنید",
  signInCodePrompt:
    "اگر این نشانی حساب کاربری داشته باشد، یک کد ۶ رقمی برای آن ایمیل کرده‌ایم. کد ۱۰ دقیقه اعتبار دارد.",
  signInCodeLabel: "کد ۶ رقمی",
  signInCodeWrong: "کد واردشده درست نیست.",
  signInCodeExpired: "اعتبار این کد تمام شده یا بیش از حد امتحان شده است. کد تازه بگیرید.",
  signInCodeResend: "ارسال کد تازه",
  signInCodeSent: "کد تازه ارسال شد.",
  firstPasswordTitle: "رمز عبور خود را انتخاب کنید",
  firstPasswordPrompt: "ایمیل شما تأیید شد. برای ورودهای بعدی یک رمز عبور انتخاب کنید.",
  signUpNoPasswordNote:
    "فعلاً رمز عبور لازم نیست: برای تأیید نشانی یک کد ایمیل می‌کنیم و سپس رمز را انتخاب می‌کنید.",
  accountNumberChoice: "شماره حساب مشتری شما",
  accountNumberPhone: "هفت رقم آخر شماره تلفنم باشد",
  accountNumberAssigned: "یک شماره به من اختصاص دهید",

  // Admin and rep
  sendQuote: "ارسال استعلام",
  quoteSentOk: "استعلام برای مشتری ارسال شد.",
  acceptForCustomer: "مشتری تأیید کرد — صدور پیش‌فاکتور",
  holdReleased: "نگهداری موجودی آزاد شد",
  adminEmails: "ایمیل‌ها",
  emailLogTitle: "ایمیل‌ها",
  emailLogEmpty: "هنوز ایمیلی ثبت نشده است.",
  emailLoggedNote: "کلید سرویس ایمیل تنظیم نشده است؛ پیام‌ها به‌جای ارسال، اینجا ثبت می‌شوند.",
  emailTo: "گیرنده",
  emailSubject: "موضوع",
  emailKind: "نوع",
  emailWhen: "زمان",
  emailStatus: "وضعیت",
  emailStatusSent: "ارسال شد",
  emailStatusLogged: "ارسال نشد (ثبت شد)",
  emailStatusFailed: "ناموفق",
  emailShowBody: "نمایش متن",
  quoteDraftNotice:
    "پیش‌نویس استعلام — هنوز چیزی ارسال نشده است. همهٔ ردیف‌ها، ارزش افزوده و مبلغ کل را بررسی و سپس ارسال کنید. استعلام برای مشتری ایمیل می‌شود و او ۵ روز فرصت دارد آن را تأیید کند. مبلغ ریالی با نرخ ارز و نرخ ارزش افزودهٔ روز تأیید ثابت می‌شود و شمارهٔ صورتحساب پس از تأیید پرداخت داده می‌شود.",
  confirmSendQuote: "این استعلام برای مشتری ارسال شود؟",
};
