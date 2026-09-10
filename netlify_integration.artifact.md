# Supabase Download Code Integration for Netlify

To integrate the download code validation into your frontend website ([meoapp.netlify.app](https://meoapp.netlify.app)), follow these steps.

## 1. Add Supabase SDK
Include the following script in the `<head>` or before the closing `</body>` tag of your website's HTML:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```

## 2. Validation Logic
Use this JavaScript snippet to handle the "Download" button click. Replace the placeholder IDs with your actual HTML element IDs.

```javascript
// Supabase Configuration
const SUPABASE_URL = "https://ltxvswccpahqpsgaxfog.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0eHZzd2NjcGFocXBzZ2F4Zm9nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5NzQ5NzQsImV4cCI6MjEwMjU1MDk3NH0.UB4b_bjgcWBHhhYmj1vv3e4rgeeIbsqcvpEN2-Xb7fM";
const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function validateAndDownload() {
    const codeInput = document.getElementById('download-code-input').value.trim().toUpperCase();
    const statusText = document.getElementById('status-message');

    if (!codeInput) {
        statusText.innerText = "Please enter a download code.";
        return;
    }

    statusText.innerText = "Validating code...";

    try {
        // 1. Check if code exists and is unused
        const { data, error } = await supabase
            .from('download_codes')
            .select('*')
            .eq('code', codeInput)
            .eq('is_used', false)
            .single();

        if (error || !data) {
            statusText.innerText = "Invalid or expired code.";
            statusText.style.color = "#E94560";
            return;
        }

        // 2. Mark code as used
        const { updateError } = await supabase
            .from('download_codes')
            .update({
                is_used: true,
                used_at: new Date().toISOString()
            })
            .eq('id', data.id);

        if (updateError) throw updateError;

        // 3. Success - Trigger download
        statusText.innerText = "Code verified! Starting download...";
        statusText.style.color = "#00ff88";

        // Replace with your actual download link
        window.location.href = "https://your-app-download-link.com/app.apk";

    } catch (err) {
        console.error("Validation error:", err);
        statusText.innerText = "Server error. Please try again later.";
    }
}
```

## 3. Recommended HTML Structure
Ensure your download section looks something like this:

```html
<div class="download-section">
    <input type="text" id="download-code-input" placeholder="Enter 8-digit code" maxlength="8">
    <button onclick="validateAndDownload()">Download App</button>
    <p id="status-message"></p>
</div>
```

> [!TIP]
> Make sure to set up **Row Level Security (RLS)** in your Supabase dashboard to allow `SELECT` and `UPDATE` on the `download_codes` table for `anon` users. Alternatively, you can create a database function to handle this securely if you want to prevent users from seeing all codes.
