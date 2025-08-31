Omnicator - Universal Zwift Translator!
=========================

![Omnicator](https://github.com/sauce-mods-sisu/omnicator/blob/master/Omnicator.png)


## Installing
------------------
A Sauce for Zwift "Mod" is a directory placed in `~/Documents/SauceMods`.  NOTE: "Documents"
may be called "My Documents" on some platforms.  For first time mod users they should create
an empty **SauceMods** folder first.  Then each Mod will be a sub directory in there such as...
```
Documents
└── SauceMods
    ├── <Put me here>
```

## Usage
------------------
### Basic Features
- Translates all Zwift messages to a language of your choosing

### Demos
- Alpha: https://www.youtube.com/watch?v=976Q1auXvYc

# Changelog 
------------------
## Aug 31 2025 (0.0.2)
- Chats now come from all of the sources, including events
- Indicator shown in chat on where it's coming from
- Added regional languages:
  - Vlaams
  - Frysk
  - Walon
  - Lëtzebuergesch
  - Cymraeg
  - Kernewek
  - Gaelg
  - Brezhoneg
  - Occitan
  - Elsässisch
  - Corsu
  - Asturianu
  - Aragonés
  - Mirandés
  - Sardu
  - Sicilianu
  - Nnapulitano
  - Vèneto
  - Lumbaart
  - Piemontèis
  - Lìguru
  - Emiliân–Rumagnòl
  - Furlan
  - Ladin
  - Rumantsch
  - Føroyskt
  - Davvisámegiella
  - Norsk nynorsk
  - Norsk bokmål
  - Crnogorski
  - Беларуская
  - Malti
  - Klingon (for the lulz)

## March 20 2025
- Selected Language is now featured in the header
- Clicking on any message restranslates it - a useful feature for if you have changed the userLanguage

## March 17 2025
- Alpha is born


# How to Acquire an OpenAI API Key

This guide explains how to obtain and securely store an OpenAI API key for use in your application. Follow the steps below to get your key and keep it safe.
Neither myself, nor anyone associated with Sauce LLC shall be liable for the costs incurred, including in the event of misplaced or stolen credentials.  
Set very narrow budgets on your API key and use the warning/monitoring features available to you.  A few dollars should last months, if not years, so please please please
set a tight budget around your API key.

---

## 1. Create an OpenAI Account

- **Sign Up:**  
  Visit the [OpenAI website](https://openai.com) and sign up for an account if you don’t have one already.
  
- **Verify Your Account:**  
  Complete any necessary verification steps, such as confirming your email address.

---

## 2. Navigate to the API Keys Section

- **Access Your Dashboard:**  
  Once logged in, go to your [API keys page](https://platform.openai.com/account/api-keys) from your account dashboard.

- **View Existing Keys:**  
  Here, you can see any API keys you’ve already generated. If you’re new, this list will be empty.

---

## 3. Generate a New API Key

- **Create a New Key:**  
  Click on the **“Create new secret key”** button. A new API key will be generated immediately.

- **Copy the Key:**  
  Make sure to copy the key immediately because for security reasons, it may not be viewable again. Store it in a secure location (e.g., a password manager).

---

## 4. Limiting API Usage to a Budget

- **Set a Spending Cap:**  
  Log into your OpenAI account and navigate to your billing or usage settings. If available, configure a spending limit to automatically stop API usage once you reach your set threshold (e.g., $5).

- **Monitor Regularly:**  
  If a spending cap isn’t directly available, consider setting up usage alerts or employing third-party monitoring tools to keep track of your API consumption.

- **Budget Management:**
  Keeping your usage under a strict budget can prevent large unexpected bills and help maintain cost control during development or testing.
---


## FAQ
==================================================
### 1. Why must I enter my API Key every session?
There is no really good way for a client-only application to store secrets (passwords, other sensitive data) without a backend and some type of authentication paradigm.
Session storage relegates your key to only being used for that time.  I am sorry if it is a pain.  I am toying with the idea of making a proxy service such that I can expose a budgeted API key for all folks to use and gauge the usage.  It's $0.60 per million tokens, I don't mind spending $10-$20/month but would be grumpy if it starts costing me $$$/month.

### 2. What is the cost?
I am currently using model `chatgpt-4o-mini` to perform translation which charges $0.60 per 1 million tokens used.  While I accurately track the number of tokens used, you will have to configure the cost per token in the Config panel.  While I will not be held liable for overages or charges, it has been incredibly cheap.  It depends on how chatty Zwfit is, but even under all day use in an event it's rare to see more than 100,000 tokens used.  Be sure to assign budgets to your API Key in the [API keys page](https://platform.openai.com/account/api-keys) 

### 3. I don't see my language, can it be added?
Most likely it can easily be added, leave me a message on Discord or in the Github repo

### 4. These translations are awful!
I am sorry!

### 5. My Language isn't shown!
Leave me a message in the Repo, on Zwift, on my YouTube and I'll add it.  One of the things I'm most proud of is this implementation makes it extremely trivial to add a new language.