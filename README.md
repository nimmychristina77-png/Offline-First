Offline First App

A small experimental project to understand how apps can work Reliably even without internet

Why I built this

Most apps today completely break when there is no connection.
I wanted to try building something that still works offline and handles syncing later.

This project is my attempt at exploring that idea in a simple way.

What it does
   • Add and manage items locally (works without internet)
   • Search data Offline
   • Queue Changes when offline
   • Sync data manually (currently simulated)

How it works
   • Data is stored locally in the browser
   • Actions are queued instead of directly sent to a server
   • When sync is triggered, queued actions are processed
This demonstrates how offline-first Systems behave in real apps.

Tech Stack
   • Vanilla JavaScript - Core logic (no frameworks, kept it simple on purpose)
   • HTML + CSS - UI structure and styling
   • IndexedDB - LocalDB - Local data storage for offline usage
   • Service Worker - Enables offline capability and caching
   • Web Crypto API - Used for local encryption (AES-GCM)
   • Custom Sync logic - Handles queueing and simulated syncing of data

Why this is built
   • Matches actual code to builds trust
   • I used JS over react,its Intentional choice

Note: I intentionally avoided frameworks to better understand how offline-first systems work at a lower level.