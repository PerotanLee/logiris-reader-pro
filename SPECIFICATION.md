# LOGIRIS News Aggregator - System Specification

## Overview
A lightweight, browser-based news aggregator designed specifically for reading Bloomberg newsletters efficiently. The application fetches unread emails directly from the user's Gmail account, filters them by recency, and displays them in a streamlined, distraction-free interface.

## Core Features

### 1. Data Source & Filtering
- **Source**: Connects to Gmail API using Google OAuth 2.0.
- **Filter Query**: `from:bloomberg.com is:unread newer_than:2d`
- **Logic**:
  - Fetches only **unread** emails from the last **48 hours**.
  - **Double-check**: client-side validation ensures strictly only `UNREAD` labeled emails are shown.
- **Sorting**: **Oldest first** (Chronological order) to follow the news timeline.

### 2. User Interface
- **Header**:
  - Minimalist design with white background.
  - "LOGIRIS" logo centered/left-aligned.
  - Height optimized for maximum content area.
- **Email List**:
  - continuous vertical stream.
  - **Counters**: Displays standard index (e.g., `1/20`) for progress tracking.
- **Email Card**:
  - **Unread Indicator**: Distinct **Blue Vertical Line** on the left edge.
  - **Meta Data**: Date/Time, Sender, Counter.
  - **Content**: Renders raw HTML from the email source (tables, images preserved).
- **Navigation**:
  - **Instant Scroll**: "▼" button (and Space/PageDown keys) jumps 80% screen height instantly (no animation) for rapid skimming.
- **Actions**:
  - **Mark as Read**: Button to archive/mark read on Gmail server and remove from the current view.

### 3. Technical Stack
- **Frontend**: Vanilla JavaScript (ES6+), CSS3.
- **Auth**: Google Identity Services (GIS) / GAPI.
- **Hosting**: GitHub Pages.
- **Deployment**: Automated via GitHub Actions (CD).

## Planned Improvements (Next Sprint)
- **Full Width Layout**: Expand container from 900px to `100%` viewport width.
- **Content Zoom**: Apply `zoom: 1.5` (or equivalent) to email bodies to maximize readability of fixed-width HTML emails.
- **Minimal Margins**: Reduce card padding while **preserving the Blue Unread Line**.
