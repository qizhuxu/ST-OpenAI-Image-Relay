# OpenAI Image Relay

This SillyTavern third-party extension watches assistant replies, extracts prompt text with a user-defined regex, sends the extracted text to an OpenAI-compatible backend, and replaces the matched prompt text with generated images.

## Intended backend

The default settings target:

- `http://127.0.0.1:8199/v1/chat/completions`
- API key: `sk-any`
- model: `any`

That matches the local backend at `C:\Users\QIU\Desktop\useful\projects\普遍反代\新测试版`, but the extension also supports other OpenAI-compatible services.

## Important settings

- `Service URL`: accepts either a full `.../chat/completions` URL or a base path such as `.../v1`
- `Prompt regex`: capture group `1` or named group `prompt` is sent to the backend
- `User prompt template`: wrap the extracted prompt before sending it upstream
- `Extra body JSON`: optional request body overrides for backend-specific fields

## Response parsing

The extension tries, in order:

1. Structured image fields such as `media` or `images`
2. The configured response image regex
3. Markdown image links inside `choices[0].message.content`
4. Loose image URLs inside the returned text
