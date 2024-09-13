// Client ID and API key from the Developer Console
const CLIENT_ID = env.client_id;
const API_KEY = env.api_key;

// Discovery doc URL for APIs used by the quickstart
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest';

// Authorization scopes required by the API; multiple scopes can be
// included, separated by spaces.
const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly';

let tokenClient;
let gapiInited = false;
let gisInited = false;

let currentLabel = 'INBOX';
let currentCategory = 'CATEGORY_PERSONAL';
let pageToken = null;

/**
 * Callback after api.js is loaded.
 */
function gapiLoaded() {
    gapi.load('client', initializeGapiClient);
}

/**
 * Callback after the API client is loaded. Loads the
 * discovery doc to initialize the API.
 */
async function initializeGapiClient() {
    await gapi.client.init({
        apiKey: API_KEY,
        discoveryDocs: [DISCOVERY_DOC],
    });
    gapiInited = true;
    maybeEnableButtons();
}

/**
 * Callback after Google Identity Services are loaded.
 */
function gisLoaded() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: '', // defined later
    });
    gisInited = true;
    maybeEnableButtons();
}

/**
 * Enables user interaction after all libraries are loaded.
 */
function maybeEnableButtons() {
    if (gapiInited && gisInited) {
        document.getElementById('authorize_button').style.display = 'block';
        checkAuth();
    }
}

/**
 *  Sign in the user upon button click.
 */
function handleAuthClick() {
    if (!tokenClient) {
        console.error('Token client not initialized');
        return;
    }

    tokenClient.callback = async (resp) => {
        if (resp.error !== undefined) {
            throw (resp);
        }
        document.getElementById('signout_button').style.display = 'block';
        document.getElementById('authorize_button').style.display = 'none';
        localStorage.setItem('gmail_token', JSON.stringify(gapi.client.getToken()));
        await listEmails();
    };

    if (gapi.client.getToken() === null) {
        tokenClient.requestAccessToken({prompt: 'consent'});
    } else {
        tokenClient.requestAccessToken({prompt: ''});
    }
}

/**
 *  Sign out the user upon button click.
 */
function handleSignoutClick() {
    const token = gapi.client.getToken();
    if (token !== null) {
        google.accounts.oauth2.revoke(token.access_token);
        gapi.client.setToken('');
        document.getElementById('email-list').innerHTML = '';
        document.getElementById('email-detail').innerHTML = '';
        document.getElementById('authorize_button').style.display = 'block';
        document.getElementById('signout_button').style.display = 'none';
        localStorage.removeItem('gmail_token');
    }
}

/**
 * Fetch and display emails from the user's inbox.
 */
async function listEmails() {
    console.log('Current Label:', currentLabel);
    console.log('Current Category:', currentCategory);

    let response;
    try {
        const params = {
            'userId': 'me',
            'labelIds': [currentLabel],
            'maxResults': 20,
            'pageToken': pageToken
        };

        // Add category filter if a category is selected
        if (currentCategory && currentCategory !== 'CATEGORY_PERSONAL') {
            params.labelIds.push(currentCategory);
        }

        response = await gapi.client.gmail.users.messages.list(params);

        console.log('API Response:', response);

        if (!response.result.messages || response.result.messages.length === 0) {
            console.log('No emails found for the current category and label.');
            document.getElementById('email-list').innerHTML = '<p>No emails found in this category.</p>';
            return;
        }

        const messages = response.result.messages;
        pageToken = response.result.nextPageToken;

        const emailList = document.getElementById('email-list');
        emailList.innerHTML = ''; // Clear existing content
        
        for (const message of messages) {
            try {
                const email = await gapi.client.gmail.users.messages.get({
                    'userId': 'me',
                    'id': message.id
                });

                const subject = email.result.payload.headers.find(header => header.name === 'Subject')?.value || 'No Subject';
                const from = email.result.payload.headers.find(header => header.name === 'From')?.value || 'Unknown Sender';
                const date = new Date(parseInt(email.result.internalDate)).toLocaleDateString();
                const isUnread = email.result.labelIds.includes('UNREAD');

                const emailItem = document.createElement('div');
                emailItem.className = `email-item ${isUnread ? 'unread' : ''}`;
                emailItem.innerHTML = `
                    <span class="sender">${from.split('<')[0]}</span>
                    <span class="subject">${subject}</span>
                    <span class="date">${date}</span>
                `;
                emailItem.onclick = () => showEmailDetail(email.result, emailItem);

                emailList.appendChild(emailItem);
            } catch (err) {
                console.error('Error fetching email details:', err);
            }
        }

        // Implement infinite scrolling
        if (pageToken) {
            const observer = new IntersectionObserver((entries) => {
                if (entries[0].isIntersecting) {
                    listEmails();
                }
            }, { threshold: 1 });

            observer.observe(emailList.lastElementChild);
        }
    } catch (err) {
        console.error('Error fetching emails:', err);
        document.getElementById('email-list').innerHTML = `<p style="color: hsl(var(--destructive));">Error fetching emails: ${err.message}</p>`;
        return;
    }
}

/**
 * Display the details of a selected email.
 */
async function showEmailDetail(email, emailItem) {
    const detailView = document.getElementById('email-detail');
    const subject = email.payload.headers.find(header => header.name === 'Subject')?.value || 'No Subject';
    const from = email.payload.headers.find(header => header.name === 'From')?.value || 'Unknown Sender';
    const to = email.payload.headers.find(header => header.name === 'To')?.value || 'Unknown Recipient';
    const date = new Date(parseInt(email.internalDate)).toLocaleString();

    let body = '';
    if (email.payload.parts) {
        const textPart = email.payload.parts.find(part => part.mimeType === 'text/plain');
        if (textPart && textPart.body.data) {
            body = atob(textPart.body.data.replace(/-/g, '+').replace(/_/g, '/'));
        }
    } else if (email.payload.body.data) {
        body = atob(email.payload.body.data.replace(/-/g, '+').replace(/_/g, '/'));
    }

    detailView.innerHTML = `
        <h2 style="font-size: 1.5rem; font-weight: 700; margin-bottom: 1rem;">${subject}</h2>
        <p><strong>From:</strong> ${from}</p>
        <p><strong>To:</strong> ${to}</p>
        <p><strong>Date:</strong> ${date}</p>
        <div class="email-body">${body}</div>
    `;
    detailView.classList.add('active');

    // Mark email as read
    if (email.labelIds.includes('UNREAD')) {
        try {
            await gapi.client.gmail.users.messages.modify({
                'userId': 'me',
                'id': email.id,
                'removeLabelIds': ['UNREAD']
            });
            emailItem.classList.remove('unread');
        } catch (err) {
            console.error('Error marking email as read:', err);
        }
    }
}

/**
 * Check if the user is already signed in and load emails if so.
 */
function checkAuth() {
    const token = localStorage.getItem('gmail_token');
    if (token) {
        gapi.client.setToken(JSON.parse(token));
        document.getElementById('signout_button').style.display = 'block';
        document.getElementById('authorize_button').style.display = 'none';
        listEmails();
    }
}

/**
 * Initialize the application
 */
function initApp() {
    document.getElementById('authorize_button').onclick = handleAuthClick;
    document.getElementById('signout_button').onclick = handleSignoutClick;

    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentCategory = tab.dataset.category;
            document.getElementById('email-list').innerHTML = '';
            pageToken = null;
            listEmails();
        });
    });

    const navItems = ['inbox', 'starred', 'sent', 'drafts', 'trash'];
    navItems.forEach(item => {
        document.getElementById(`${item}_button`).addEventListener('click', () => {
            navItems.forEach(i => document.getElementById(`${i}_button`).classList.remove('active'));
            document.getElementById(`${item}_button`).classList.add('active');
            currentLabel = item.toUpperCase();
            document.getElementById('email-list').innerHTML = '';
            pageToken = null;
            listEmails();
        });
    });
}

// Expose the functions to the global scope
window.gapiLoaded = gapiLoaded;
window.gisLoaded = gisLoaded;

// Initialize the app when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', initApp);