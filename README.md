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
- TTS for English translations

### Demos
- Alpha: https://www.youtube.com/watch?v=976Q1auXvYc

# Changelog 
------------------
## Feb 27 2026 (0.1.0)
- Modified README to eliminate information or requirement for OpenAI key
- There aren't too many users and so I'm happy to throw a $10 budget/month on translations (we aren't getting close)
- Enabled TTS for English translations using [KittenTTS](https://github.com/KittenML/KittenTTS) which runs locally  (~80MB)
   - You don't have to enable and you won't incur use of your compute or storage
   - Stores to IndexDB the model/weights
   - Pins voices to chat users so that you can identify who is speaking and who is responding
      - You can clear pins in settings
      - Pins are localStorage, will store up to 10,000 with an LRU, about 270KB
- Security Review
  - Found and fixed 3 Medium Severity issues
    - Prompt Injection vector
    - Hash check on import of script
    - Removed the previous feature of bringing your own OpenAI key 
- Security Posture and Exfiltration
  - To be able to hide my own API key I wired Omnicator into my own servers (last update 0.0.3)
  - My servers will see all of your chat.  I don't store it, but there is nothing stopping me technically
    - This is a deeply honest admission so you know the full blast radius of using this.  I promise it's significantly better posturing than most software out there and that I take data stewardship seriously

## Sept 1 2025 (0.0.3)
- Sever side translations (on my dime)
- We will see how well this works, will shut down or ask for donations if it becomes a lot of money

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


## FAQ
==================================================
### 1. I don't see my language, can it be added?
Most likely it can easily be added, leave me a message on Discord or in the Github repo

### 2. These translations are awful!
I am sorry!

### 3. My Language isn't shown!
Leave me a message in the Repo, on Zwift, on my YouTube and I'll add it.  One of the things I'm most proud of is this implementation makes it extremely trivial to add a new language.