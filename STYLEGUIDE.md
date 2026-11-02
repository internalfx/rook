# Style Guide

## General

- Write code that is explicit and hard to misread.
- Avoid clever one-liners or implicit negation where a clear, direct check is needed.
- Using intermediate variables is preferred over chaining function calls
- optimize for code readability, and ease of human comprehension
- Avoid abstracting code that is used less than 3 times, unless it is huge.
- Avoid javascript classes if at all possible, prefer functions and objects.
- Avoid the javascript keyword "this". Front end components that need it (like alpinejs) can ignore this policy.