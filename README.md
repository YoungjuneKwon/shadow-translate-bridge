# @winm2m/shadow-translate-bridge

**A lightweight bridge to sync Shadow DOM content with browser translation engines (like Google Translate).**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://badge.fury.io/js/%40winm2m%2Fshadow-translate-bridge.svg)](https://badge.fury.io/js/%40winm2m%2Fshadow-translate-bridge)

## The Problem

If you build Web Components using **Shadow DOM** (especially in `closed` mode) or use wrappers like `r2wc`, you've likely encountered a major issue:

**Browser built-in translation tools (e.g., Chrome's Google Translate) cannot translate text inside the Shadow DOM.**

Browsers typically skip Shadow Roots when traversing the DOM for translation to preserve encapsulation. As a result, while the rest of your website translates perfectly, your Web Components remain in the original language, breaking the user experience for international visitors.

## The Solution: Mirroring Strategy

`@winm2m/shadow-translate-bridge` solves this by creating a **Translation Mirror** in the Light DOM.

1.  **Mirroring:** When your component renders text, this library copies that text to a hidden `<div>` in the document's main Light DOM (where the browser *can* see it).
2.  **Translation:** When the user activates Google Translate, the browser translates the text in the hidden mirror element.
3.  **Synchronization:** The library uses a singleton `MutationObserver` to detect this change in the mirror and immediately executes a callback to update your component's internal state with the translated text.

This approach ensures your Shadow DOM components are translated seamlessly without breaking encapsulation or requiring complex configuration.

## Installation

```bash
npm install @winm2m/shadow-translate-bridge
# or
yarn add @winm2m/shadow-translate-bridge
```

## Usage

### 1. Wrap your application (or root) with the Provider
The provider initializes the MirrorManager and the MutationObserver. It must be placed in the Light DOM (e.g., your main application entry point), or at least outside the closed Shadow DOM of the target components.

```TypeScript
import React from 'react';
import { TranslationBridgeProvider } from '@winm2m/shadow-translate-bridge';
import App from './App';

const Root = () => (
  <TranslationBridgeProvider>
    <App />
  </TranslationBridgeProvider>
);

export default Root;
```

### 2. Use the Hook in your Component
Inside your React component (which lives inside the Web Component/Shadow DOM), use the useShadowTranslation hook.

```TypeScript
import React, { useState } from 'react';
import { useShadowTranslation } from '@winm2m/shadow-translate-bridge';

interface Props {
  initialTitle: string;
}

const MyShadowComponent = ({ initialTitle }: Props) => {
  // 1. Maintain the text in local state
  const [displayTitle, setDisplayTitle] = useState(initialTitle);

  // 2. Register the text with the bridge
  // - First argument: The text you want to translate (source of truth)
  // - Second argument: Callback that runs when the browser translates the text
  useShadowTranslation(initialTitle, (translatedText) => {
    setDisplayTitle(translatedText);
  });

  return (
    <div className="card">
      {/* 3. Render the state, not the prop directly */}
      <h1>{displayTitle}</h1>
      <p>
        Try right-clicking and selecting "Translate to [Language]" 
        in Chrome!
      </p>
    </div>
  );
};

export default MyShadowComponent;
```


## How it works under the hood
Unique Identity: The library assigns a unique UUID to every registered text string.

Invisible DOM: It creates a container <div id="shadow-translate-bridge-mirror"> appended to document.body. This container is visually hidden (using clip, not display: none) so browsers still recognize it as "translatable content."

Performance: Instead of attaching an observer to every single element, it uses one single MutationObserver on the container to monitor all text changes efficiently.

## Requirements & Limitations
React: Requires React 16.8+ (Hooks support).

Browser Support: Works in all modern browsers that support MutationObserver and Shadow DOM.

Dynamic Content: This library relies on the browser's translation engine. It does not translate content itself; it acts as a bridge for the browser's native behavior.

## Contributing
Contributions are welcome! Please feel free to submit a Pull Request.

## License
This project is licensed under the MIT License - see the LICENSE file for details.