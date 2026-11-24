-- Extra data shown with a chat message (price cards, "photo attached" flag), as JSON.
ALTER TABLE agribot_messages ADD COLUMN meta TEXT;
