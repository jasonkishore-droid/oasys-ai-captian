// The tools Greeny can call during a voice chat (Gemini function calling).
// The server sends these declarations to Gemini when a chat starts; the
// browser runs the calls (see src/tools.js). To add a tool: declare it here
// and add a handler with the same name in src/tools.js.
export const TOOL_DECLARATIONS = [
  {
    name: 'list_users',
    description:
      'Look up everyone registered with a saved face or voice, who is on camera right now, who is speaking, ' +
      'whether you are awake or asleep, and the current wake rule. Call this before making decisions about specific people.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'set_wake_policy',
    description:
      'Choose who is allowed to wake you up. Use it when someone says things like "don\'t wake up until I come back" ' +
      'or "only wake up for me or Sam". Anyone not allowed (strangers, other people) will not wake you, even if they stand in front of the camera. ' +
      'By default you go to sleep right away.',
    parameters: {
      type: 'OBJECT',
      properties: {
        wake_for: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Names of registered users who may wake you. Use the real name of the speaker when they say "me" or "I".',
        },
        any_registered: {
          type: 'BOOLEAN',
          description: 'True if any registered user (anyone with a saved face) may wake you, but not strangers.',
        },
        sleep_now: {
          type: 'BOOLEAN',
          description: 'Go to sleep immediately (default true). Set false to only apply the rule when you next fall asleep.',
        },
      },
    },
  },
  {
    name: 'clear_wake_policy',
    description: 'Remove any wake rule so that anyone showing their face wakes you again.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'go_to_sleep',
    description: 'Go to sleep now. You wake up the next time someone arrives in front of the camera (after the current person has left).',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'wake_up',
    description: 'Wake up now and drop any wake rule.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'register_face',
    description:
      'Save the new person standing in front of the camera. Use it when someone says things like "save him as Sam" or "remember her as Priya". ' +
      'It takes a clear photo of the face on camera. Nothing is stored until confirm_pending is called, so afterwards ask the user to confirm the name.',
    parameters: {
      type: 'OBJECT',
      properties: { name: { type: 'STRING', description: 'The name to save this person under.' } },
      required: ['name'],
    },
  },
  {
    name: 'register_voice',
    description:
      'Start recording the voice of the person who is about to talk, to save it under a name ("save his voice too"). ' +
      'It returns immediately: tell the person to keep talking for about 8 seconds, then call finish_voice_recording.',
    parameters: {
      type: 'OBJECT',
      properties: { name: { type: 'STRING', description: 'Optional. The name is filled in automatically from the registered person on camera (or a face just saved); otherwise ask for it after recording and pass it to confirm_pending.' } },
    },
  },
  {
    name: 'finish_voice_recording',
    description: 'Wait for the voice sample started by register_voice to be complete (up to about 15 seconds), then ask the user to confirm.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'remove_person',
    description:
      'Delete a registered person\'s saved face, voice, or both ("remove Sam", "forget his voice"). ' +
      'Nothing is deleted until confirm_pending is called, so ask the user to confirm first.',
    parameters: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING', description: 'The registered name to remove.' },
        what: { type: 'STRING', description: 'face, voice, or both (default both).' },
      },
      required: ['name'],
    },
  },
  {
    name: 'confirm_pending',
    description:
      'Finish or cancel the pending save or delete. Call it with confirm true only after the user clearly said yes to your confirmation question, ' +
      'or with confirm false if they said no or changed their mind. If they corrected the spelling of the name, pass the corrected name.',
    parameters: {
      type: 'OBJECT',
      properties: {
        confirm: { type: 'BOOLEAN', description: 'True to save/delete, false to cancel.' },
        name: { type: 'STRING', description: 'Corrected name, only when saving and the user changed it.' },
      },
      required: ['confirm'],
    },
  },
  {
    name: 'set_camera',
    description:
      'Turn the camera on or off ("turn the camera off", "privacy"), or switch between the front and rear camera ("use the back camera"). ' +
      'Off means nothing is tracked and the camera light goes out.',
    parameters: {
      type: 'OBJECT',
      properties: {
        on: { type: 'BOOLEAN', description: 'True to turn the camera on, false to turn it off.' },
        facing: { type: 'STRING', description: 'front or rear, to switch cameras (turns the camera on).' },
      },
    },
  },
  {
    name: 'take_photo',
    description:
      'Take a photo with the camera ("take a picture", "take a selfie of us"). A short countdown is shown, then the photo pops up ' +
      'with buttons to download it or save it to the photo folder. If the user already said what to do with it, pass save; otherwise ' +
      'ask them, then call save_photo.',
    parameters: {
      type: 'OBJECT',
      properties: {
        delay_seconds: { type: 'NUMBER', description: 'Countdown before the photo, 0 to 10 (default 3).' },
        save: { type: 'STRING', description: 'download (to their browser), folder (the photo folder on the computer), or ask (default).' },
      },
    },
  },
  {
    name: 'save_photo',
    description: 'Do something with the photo just taken: download it to the browser, save it to the photo folder, or close it.',
    parameters: {
      type: 'OBJECT',
      properties: { where: { type: 'STRING', description: 'download, folder, or close.' } },
      required: ['where'],
    },
  },
  {
    name: 'close_popups',
    description:
      "Close whatever is open over your face: the photo card, a person's card, the people wheel, windows, settings and notifications " +
      '("close it", "close that", "get rid of the pop-up"). A pending save or delete is cancelled. ' +
      'It leaves the menu card open: that is closed only with show_menu (show false).',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'see_screen',
    description:
      "Look at this computer's screen. You receive a picture of the screen right after this call; the mouse pointer is circled in red. " +
      'Positions for the mouse tools are on a 0-1000 grid over that picture (0,0 top left, 1000,1000 bottom right). ' +
      'Call it before moving or clicking, and again after an action to check what happened.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'click_text',
    description:
      "Click on words shown on this computer's screen, found precisely by reading the screen: a link, button, tab or menu item " +
      '("click AI Mode", "click the first result"). Pass the exact words as they appear (for a link, its title or the start of it). ' +
      'When the words appear more than once, occurrence picks which one, counted top to bottom. Prefer this over mouse_click.',
    parameters: {
      type: 'OBJECT',
      properties: {
        text: { type: 'STRING', description: 'The words to click, as written on screen.' },
        occurrence: { type: 'NUMBER', description: '1 for the first (top-most) match, 2 for the second... Default 1.' },
        button: { type: 'STRING', description: 'left (default) or right.' },
        double: { type: 'BOOLEAN', description: 'True for a double click.' },
      },
      required: ['text'],
    },
  },
  {
    name: 'fill_field',
    description:
      'Type into a form field found by its label or placeholder text on screen ("put Chennai in From", "fill the To box with Delhi"). ' +
      'It clicks the field, clears it and types. If the label sits above the box, set where to below; if it is to the left, right. ' +
      'Autocomplete boxes often show suggestions afterwards: pick one with click_text.',
    parameters: {
      type: 'OBJECT',
      properties: {
        field: { type: 'STRING', description: "The field's label or placeholder, as written on screen (e.g. From, To, Search)." },
        text: { type: 'STRING', description: 'What to type.' },
        where: { type: 'STRING', description: 'on (default: the text is inside the box), below or right of the label.' },
        enter: { type: 'BOOLEAN', description: 'Press Enter afterwards.' },
        occurrence: { type: 'NUMBER', description: 'Which match when the label appears more than once (top to bottom).' },
      },
      required: ['field', 'text'],
    },
  },
  {
    name: 'search_web',
    description:
      'Search the web for something ("search for cheap flights to Goa", "google the weather"). Types it into the browser in front ' +
      "(its address bar), or opens a new tab when no browser is in front. Use this for any search instead of finding the search box.",
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'What to search for.' },
        new_tab: { type: 'BOOLEAN', description: 'True to search in a new tab.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_screen',
    description:
      "Read all the text on this computer's screen, line by line in reading order with positions. Use it to find exact wording " +
      "(the first search result's title, a button's label) before click_text, or to answer what is on screen.",
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'mouse_move',
    description: 'Move the mouse pointer on this computer to a point on the screen.',
    parameters: { type: 'OBJECT', properties: { x: { type: 'NUMBER', description: 'Across the screen, 0 (left edge) to 1000 (right edge), read off the latest see_screen picture.' }, y: { type: 'NUMBER', description: 'Down the screen, 0 (top) to 1000 (bottom).' } }, required: ['x', 'y'] },
  },
  {
    name: 'mouse_click',
    description: 'Click on this computer: at a point (x, y) if given, otherwise where the pointer is. Left click by default; right click or double click on request.',
    parameters: {
      type: 'OBJECT',
      properties: {
        x: { type: 'NUMBER', description: 'Across the screen, 0 (left edge) to 1000 (right edge), read off the latest see_screen picture.' },
        y: { type: 'NUMBER', description: 'Down the screen, 0 (top) to 1000 (bottom).' },
        button: { type: 'STRING', description: 'left (default), right or middle.' },
        double: { type: 'BOOLEAN', description: 'True for a double click.' },
      },
    },
  },
  {
    name: 'mouse_scroll',
    description: 'Scroll the window under the mouse pointer up or down.',
    parameters: {
      type: 'OBJECT',
      properties: {
        direction: { type: 'STRING', description: 'up or down.' },
        amount: { type: 'NUMBER', description: 'How far, 1 to 30 steps (default 5).' },
      },
      required: ['direction'],
    },
  },
  {
    name: 'type_text',
    description: "Type text on this computer's keyboard into whatever has focus (click the text box first).",
    parameters: { type: 'OBJECT', properties: { text: { type: 'STRING', description: 'The text to type.' } }, required: ['text'] },
  },
  {
    name: 'press_keys',
    description: 'Press a key or a shortcut on this computer, like "enter", "esc", "ctrl+t", "alt+tab", "ctrl+w".',
    parameters: { type: 'OBJECT', properties: { keys: { type: 'STRING', description: 'Keys joined with +.' } }, required: ['keys'] },
  },
  {
    name: 'open_tab',
    description: 'Open a new browser tab on this computer, at a website if one is named ("open YouTube in a new tab").',
    parameters: { type: 'OBJECT', properties: { url: { type: 'STRING', description: 'The web address, like youtube.com. Leave out for a blank search page.' } } },
  },
  {
    name: 'show_users',
    description:
      'Show everyone you know (saved faces and voices) as a turning wheel of photos at the right side of the screen. ' +
      'Use it when someone says "show all users", "who do you know", or "show me the people". Pass show false to hide it.',
    parameters: {
      type: 'OBJECT',
      properties: { show: { type: 'BOOLEAN', description: 'True to show the people (default), false to hide them.' } },
    },
  },
  {
    name: 'show_user',
    description:
      "Show one person's card (photo, name, what is saved about them) in front of the screen. Use it when someone asks to see a specific " +
      'person: "show me Sam", "who is Sam", "pull up their card". Pass hide true to close it.',
    parameters: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING', description: 'The name of the registered person.' },
        hide: { type: 'BOOLEAN', description: 'True to close the card.' },
      },
    },
  },
  {
    name: 'remember_fact',
    description:
      'Remember a short fact about a person ("remember I like green tea"). It is saved and you will know it in future chats. ' +
      'Defaults to the person who is speaking.',
    parameters: {
      type: 'OBJECT',
      properties: {
        fact: { type: 'STRING', description: 'The fact, in a short sentence.' },
        person: { type: 'STRING', description: 'Who it is about. Leave out for the current speaker.' },
      },
      required: ['fact'],
    },
  },
  {
    name: 'forget_fact',
    description: 'Forget saved facts that mention a word or phrase ("forget that I like tea"). Defaults to the current speaker.',
    parameters: {
      type: 'OBJECT',
      properties: {
        about: { type: 'STRING', description: 'A word or phrase from the fact to forget.' },
        person: { type: 'STRING', description: 'Whose facts. Leave out for the current speaker.' },
      },
      required: ['about'],
    },
  },
  {
    name: 'list_facts',
    description: 'Read back what you remember about a person ("what do you know about me?"). Defaults to the current speaker.',
    parameters: { type: 'OBJECT', properties: { person: { type: 'STRING', description: 'Whose facts. Leave out for the current speaker.' } } },
  },
  {
    name: 'show_emotion',
    description: 'Show a feeling on your face for a few seconds ("look happy", "act surprised").',
    parameters: {
      type: 'OBJECT',
      properties: {
        emotion: { type: 'STRING', description: 'One of: neutral, happy, curious, surprised, sleepy.' },
        seconds: { type: 'NUMBER', description: 'How long to hold it (default 6, up to 60).' },
      },
      required: ['emotion'],
    },
  },
  {
    name: 'greet_on_arrival',
    description: 'Turn greeting on or off: when a registered person comes back in front of the camera you say hello to them by name.',
    parameters: {
      type: 'OBJECT',
      properties: { enabled: { type: 'BOOLEAN', description: 'True to greet people when they arrive (default), false to stop.' } },
    },
  },
  {
    name: 'set_timer',
    description: 'Start a timer ("remind me in 10 minutes to check the oven"). You will tell the user when it finishes.',
    parameters: {
      type: 'OBJECT',
      properties: {
        minutes: { type: 'NUMBER', description: 'Minutes.' },
        seconds: { type: 'NUMBER', description: 'Seconds.' },
        label: { type: 'STRING', description: 'What the timer is for.' },
      },
    },
  },
  {
    name: 'cancel_timer',
    description: 'Cancel a timer by its label, or all timers if no label is given.',
    parameters: { type: 'OBJECT', properties: { label: { type: 'STRING', description: 'The timer label.' } } },
  },
  {
    name: 'change_colors',
    description: 'Change your eye colour and/or face colour. Accepts colour names (red, blue, pink...) or hex like #ff8800.',
    parameters: {
      type: 'OBJECT',
      properties: {
        eye_color: { type: 'STRING', description: 'New eye (iris) colour.' },
        face_color: { type: 'STRING', description: 'New face and body colour.' },
      },
    },
  },
  // ---- Restaurant ordering (Stock Management app, via /api/oasys) ----
  {
    name: 'get_menu',
    description:
      'See what the restaurant has available right now, with prices in rupees (and portions left, where tracked). ' +
      'Use it when someone asks what dishes or drinks there are, or the price of something. Sold-out dishes are not listed. ' +
      'Always call this (or place_order) before saying any price or whether something is available; never guess from memory. ' +
      'Menu prices are before tax. ' +
      'Dietary filter: when a guest says what they cannot eat ("I am Jain", "no onion", "I have a nut allergy", "anything vegan?"), pass diet and/or avoid. ' +
      'The answer says which dishes the kitchen has confirmed and which are not yet confirmed; follow its instructions exactly and never promise a dish is safe for an allergy. ' +
      'The filter is remembered for the table: each later round is checked against it.',
    parameters: {
      type: 'OBJECT',
      properties: {
        category: { type: 'STRING', description: 'Optional menu section, e.g. Breakfast & Tiffin, Dosa Varieties, Biryani & Rice, Meals, Chicken Starters, Vegetarian Gravies, Parotta & Breads, Desserts or Beverages.' },
        search: { type: 'STRING', description: 'Optional: a word to look for, like "dosa" or "biryani".' },
        diet: {
          type: 'STRING',
          enum: ['veg', 'egg', 'vegan', 'jain'],
          description: 'Optional dietary filter when a guest says they are vegetarian (veg), eat egg but no meat (egg), vegan, or Jain (no onion, garlic or root vegetables).',
        },
        avoid: {
          type: 'ARRAY',
          items: { type: 'STRING', enum: ['onion', 'garlic', 'onion-garlic', 'rootveg', 'gluten', 'dairy', 'egg', 'nuts', 'peanut', 'treenut', 'sesame', 'soy', 'fish', 'shellfish', 'seafood'] },
          description: 'Optional: what a guest cannot or will not eat, e.g. "no onion" -> ["onion"], "nut allergy" -> ["nuts"], "no prawns or crab" -> ["shellfish"].',
        },
        clear_filter: { type: 'BOOLEAN', description: 'True when the guest says to stop filtering, or the guest who asked for it has left.' },
      },
    },
  },
  {
    name: 'show_menu',
    description:
      'Put the menu card on screen: a carousel with one card per menu section (dishes, prices, veg / non-veg marks, sold-out dishes struck through). ' +
      'Call it whenever the guest asks to see the menu, the menu card, or what there is (e.g. "show me the desserts"): pass the section to open it there. ' +
      'Call it again with another section to turn to it. ' +
      'The menu card STAYS OPEN while the guest browses and orders (the order card shows beside it): never close it on your own. ' +
      'Call show_menu with show false only when the guest says to close it ("ok, close the menu"), or when they seem done: then first ask ' +
      '"Shall I close the menu?" and close it only after a yes. ' +
      'Keep talking briefly about a few dishes; for exact prices or stock use get_menu. When the guest orders, call place_order as usual. ' +
      'Pass diet / avoid to show only the dishes that fit what a guest cannot eat (same words as get_menu).',
    parameters: {
      type: 'OBJECT',
      properties: {
        section: { type: 'STRING', description: 'Optional section to open at, e.g. "Desserts", "Dosa Varieties", "Chicken Starters", "Beverages".' },
        show: { type: 'BOOLEAN', description: 'False to close the menu card. Default true.' },
        diet: {
          type: 'STRING',
          enum: ['veg', 'egg', 'vegan', 'jain'],
          description: 'Optional dietary filter when a guest says they are vegetarian (veg), eat egg but no meat (egg), vegan, or Jain (no onion, garlic or root vegetables).',
        },
        avoid: {
          type: 'ARRAY',
          items: { type: 'STRING', enum: ['onion', 'garlic', 'onion-garlic', 'rootveg', 'gluten', 'dairy', 'egg', 'nuts', 'peanut', 'treenut', 'sesame', 'soy', 'fish', 'shellfish', 'seafood'] },
          description: 'Optional: what a guest cannot or will not eat, e.g. "no onion" -> ["onion"], "nut allergy" -> ["nuts"], "no prawns or crab" -> ["shellfish"].',
        },
        clear_filter: { type: 'BOOLEAN', description: 'True when the guest says to stop filtering, or the guest who asked for it has left.' },
      },
    },
  },
  {
    name: 'place_order',
    description:
      'Order food or drinks for the table. The bot sits on the table and the guests keep ONE open tab for their whole meal: ' +
      'they may order several rounds (starters, then mains, then dessert, then tea), and each round is added to the tab and sent to the kitchen. ' +
      'This call only prepares the round: it matches the items, checks stock and shows it on screen. ' +
      'Read the items (not the prices, which are on screen) back to the guest and ask them to confirm, then call confirm_order. ' +
      'Never say a price or total out loud unless the guest asks for it. NEVER ask how they will pay here: payment is only when they close the tab (close_tab). ' +
      'If an item is ambiguous, unavailable or short on stock, tell the guest and ask what they want instead. ' +
      'While a round is still waiting for the guest’s yes, the items you pass are ADDED to it (pass only the new ones; the card then shows the whole round). ' +
      'Use replace true only when the guest wants to start that round over or change what is in it (then pass the full round).',
    parameters: {
      type: 'OBJECT',
      properties: {
        items: {
          type: 'ARRAY',
          description: 'What to order in this round.',
          items: {
            type: 'OBJECT',
            properties: {
              name: { type: 'STRING', description: 'The item as the guest said it, e.g. "masala dosa", "filter coffee".' },
              quantity: { type: 'INTEGER', description: 'How many (default 1).' },
              note: {
                type: 'STRING',
                description:
                  'Optional special request for the kitchen for this dish, in a few words, e.g. "less oil", "no onion", "extra spicy", "sugar on the side". ' +
                  'Only what the guest asked for. If only some of them get it ("two dosas, one without onion"), list the dish twice: 1 with the note, 1 without.',
              },
            },
            required: ['name'],
          },
        },
        kitchen_note: {
          type: 'STRING',
          description: 'Optional special request for the whole round, not one dish, e.g. "serve the starters first", "make everything mild".',
        },
        table: { type: 'STRING', description: 'Table number, only if the guest said it (the app usually knows its own table).' },
        replace: { type: 'BOOLEAN', description: 'True to throw away the round waiting for a yes and use only these items. Default false: add to it.' },
        guest_name: { type: 'STRING', description: 'Guest name for the bill. Defaults to whoever is speaking.' },
        guest_email: { type: 'STRING', description: 'Only if the guest already said an email address; it is suggested for the e-receipt when the tab is paid, never sent automatically.' },
      },
      required: ['items'],
    },
  },
  {
    name: 'add_special_request',
    description:
      'Add a special request for the kitchen ("less oil", "no onion", "not too spicy", "serve the starters first") to the round ' +
      'waiting for the guest\'s yes, when they ask for it after place_order and before confirm_order. ' +
      'Give item for a request about one dish; leave item out for a request about the whole round. ' +
      'It does not change the price. It cannot change a round that has already gone to the kitchen. ' +
      'When the guest asks for something while ordering, pass it as the item\'s note in place_order instead.',
    parameters: {
      type: 'OBJECT',
      properties: {
        request: { type: 'STRING', description: 'The request in a few words, e.g. "less oil", "no onion", "extra spicy".' },
        item: { type: 'STRING', description: 'Optional: the dish it is for, as in the round, e.g. "masala dosa". Leave out for the whole round.' },
        quantity: { type: 'INTEGER', description: 'Optional: how many of that dish get it, when only some do ("one of the two dosas"). Default: all of them.' },
      },
      required: ['request'],
    },
  },
  {
    name: 'confirm_order',
    description:
      'Send or cancel the round prepared by place_order, after the guest has clearly said yes (confirm true) or no (confirm false). ' +
      'On yes the round goes on the table\'s open tab and to the kitchen. Nothing is paid yet and the tab stays open: ' +
      'do NOT ask about payment or receipts afterwards. The guests can keep ordering until they ask for the bill.',
    parameters: {
      type: 'OBJECT',
      properties: {
        confirm: { type: 'BOOLEAN', description: 'True to send the round to the kitchen, false to cancel it.' },
      },
      required: ['confirm'],
    },
  },
  {
    name: 'view_tab',
    description:
      'Show what the table has ordered so far on its open tab (every round, and the running total) when the guest asks ' +
      '"what have we ordered?" or "how much is it so far?". It does not close the tab.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'rate_meal',
    description:
      'Feedback after the tab is paid. Call it WITHOUT a rating once the receipt question is settled: it shows a 1 to 5 star rating card. ' +
      'Ask once, briefly; rating is optional, never push. When the guest gives a rating, call it again WITH the rating, plus what they liked or ' +
      'what could be better if they said, and any comment in their words. Calling again for the same bill updates it (e.g. a comment added later).',
    parameters: {
      type: 'OBJECT',
      properties: {
        rating: { type: 'INTEGER', description: 'Stars from 1 (poor) to 5 (excellent). Map words: "excellent" 5, "good" 4, "okay" 3, "not great" 2, "bad" 1.' },
        liked: {
          type: 'ARRAY',
          items: { type: 'STRING', enum: ['food', 'service', 'speed', 'value', 'ambience', 'cleanliness'] },
          description: 'Optional: what they praised.',
        },
        improve: {
          type: 'ARRAY',
          items: { type: 'STRING', enum: ['food', 'service', 'speed', 'value', 'ambience', 'cleanliness'] },
          description: 'Optional: what could be better.',
        },
        comment: { type: 'STRING', description: 'Optional: their comment, close to their own words, e.g. "the sambar was too salty".' },
      },
    },
  },
  {
    name: 'call_waiter',
    description:
      'Call a human waiter to the table. Call it straight away, without asking for confirmation, when a guest asks for a waiter, ' +
      'for someone to come over, for help you cannot give, or for something only staff can bring (water, cutlery, napkins, cleaning up a spill). ' +
      'Do NOT use it for ordering food or drinks (place_order) or for paying (close_tab), unless the guest says they want a person for that. ' +
      'After it, tell the guest in one short sentence that a waiter has been called. Calling again while a call is waiting reminds the staff.',
    parameters: {
      type: 'OBJECT',
      properties: {
        reason: {
          type: 'STRING',
          enum: ['help', 'water', 'bill', 'cutlery', 'clean', 'other'],
          description: 'Why: help (general, the default), water, bill (wants to pay with a person), cutlery (also napkins, plates), clean (spill, clear the table), other.',
        },
        note: { type: 'STRING', description: 'Optional: what they need in a few words, e.g. "two glasses of water", "spilled coffee", "high chair".' },
      },
    },
  },
  {
    name: 'cancel_waiter_call',
    description: 'Cancel the table\'s waiter call, only when the guest says they no longer need the waiter.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'close_tab',
    description:
      'Close the table\'s tab and take payment, ONLY when the guest asks for the bill, to pay, to settle up or to close the tab ' +
      '(never on your own, and never just because a round was ordered). First call it without payment_method: it shows the whole tab and its total. ' +
      'Then ask how they will pay (cash, UPI or card; never assume cash) and call it again with their answer. Only then is the bill made and paid. ' +
      'Afterwards, offer a paper receipt (print_receipt) and an e-receipt by email (set_receipt_email); the guest can have either, both or neither.',
    parameters: {
      type: 'OBJECT',
      properties: {
        payment_method: { type: 'STRING', description: 'How the guest will pay: cash, upi or card. Leave it out on the first call; give it once the guest has told you.' },
      },
    },
  },
  {
    name: 'print_receipt',
    description:
      'Print a paper receipt for the bill just paid (after close_tab), on the restaurant printer. NEVER call it on your own or straight after the tab is paid: ' +
      'first ask the guest if they want a paper receipt, and call this only after they clearly said yes (or tapped the print button). ' +
      'It reports whether the receipt really printed; if it did not, say so and offer an e-receipt instead.',
    parameters: {
      type: 'OBJECT',
      properties: { guest_asked: { type: 'BOOLEAN', description: 'True only if the guest just asked for a paper receipt in answer to your question.' } },
      required: ['guest_asked'],
    },
  },
  {
    name: 'set_receipt_email',
    description:
      'After the tab is paid (close_tab), when the guest wants an e-receipt: give the email address they said. Nothing is sent yet. ' +
      'It shows the address on screen and returns it spelled out; read it back and ask "is that right?", then call send_receipt.',
    parameters: {
      type: 'OBJECT',
      properties: { email: { type: 'STRING', description: 'The address as said, e.g. "jason at gmail dot com" or "jason@gmail.com".' } },
      required: ['email'],
    },
  },
  {
    name: 'send_receipt',
    description:
      'Send the e-receipt to the address from set_receipt_email, only after the guest has confirmed it is correct (confirm true). ' +
      'confirm false means the address was wrong: ask again and call set_receipt_email.',
    parameters: {
      type: 'OBJECT',
      properties: { confirm: { type: 'BOOLEAN', description: 'True if the guest confirmed the address is right.' } },
      required: ['confirm'],
    },
  },
]
