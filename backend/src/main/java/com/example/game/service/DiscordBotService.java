package com.example.game.service;

import net.dv8tion.jda.api.JDA;
import net.dv8tion.jda.api.JDABuilder;
import net.dv8tion.jda.api.requests.GatewayIntent;
import net.dv8tion.jda.api.entities.Guild;
import java.util.List;
import net.dv8tion.jda.api.entities.Activity;
import net.dv8tion.jda.api.entities.channel.concrete.TextChannel;
import net.dv8tion.jda.api.entities.Member;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import net.dv8tion.jda.api.events.message.MessageReceivedEvent;
import net.dv8tion.jda.api.hooks.ListenerAdapter;
import jakarta.annotation.PostConstruct;

public class DiscordBotService extends ListenerAdapter {

    private final String token;
    private final String defaultChannelId;
    private final String playUrl;
    private JDA jda;
    private final java.util.Map<String, String> sessionTokenToChannel = new java.util.concurrent.ConcurrentHashMap<>();

    public DiscordBotService(String token, String defaultChannelId, String playUrl) {
        this.token = token;
        this.defaultChannelId = defaultChannelId;
        this.playUrl = playUrl;
    }

    @PostConstruct
    public void startBot() {
        if (token == null || token.isBlank()) {
            System.out.println("[DiscordBotService] Aucun token Discord fourni, le bot ne démarre pas.");
            return;
        }

        // Enable required gateway intents (MESSAGE_CONTENT is privileged and must be enabled in the Dev Portal)
        this.jda = JDABuilder.createDefault(token,
            GatewayIntent.GUILD_MESSAGES,
            GatewayIntent.MESSAGE_CONTENT,
            GatewayIntent.GUILD_MESSAGE_REACTIONS)
                .addEventListeners(this)
                .setActivity(Activity.playing("Jeu de golf test"))
                .build();

        // Log accessible guilds and text channels once JDA is ready
        new Thread(() -> {
            try {
                jda.awaitReady();
                System.out.println("[DiscordBotService] Bot prêt. Guildes accessibles :");
                List<Guild> guilds = jda.getGuilds();
                for (Guild g : guilds) {
                    System.out.println(" - " + g.getName() + " (" + g.getId() + ")");
                    g.getTextChannels().forEach(tc -> System.out.println("    channel: " + tc.getName() + " (" + tc.getId() + ")"));
                }
                if (defaultChannelId != null && !defaultChannelId.isBlank()) {
                    TextChannel ch = jda.getTextChannelById(defaultChannelId);
                    if (ch != null) {
                        System.out.println("[DiscordBotService] default-channel-id trouvé: " + ch.getName() + " (" + defaultChannelId + ")");
                    } else {
                        System.out.println("[DiscordBotService] default-channel-id non trouvé dans les guildes accessibles: " + defaultChannelId);
                    }
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }).start();
    }

    @Override
    public void onMessageReceived(MessageReceivedEvent event) {
        if (event.getAuthor().isBot()) {
            return;
        }
        String content = event.getMessage().getContentRaw();
        if (content.startsWith("!ping")) {
            event.getChannel().sendMessage("Pong depuis le backend Spring!").queue();
        }
        if (content.startsWith("!status")) {
            event.getChannel().sendMessage("Backend Spring et bot Discord fonctionnels").queue();
        }
        if (content.startsWith("!play")) {
            try {
                String username = event.getAuthor().getName();
                Member member = event.getMember();
                if (member != null && member.getEffectiveName() != null && !member.getEffectiveName().isBlank()) {
                    username = member.getEffectiveName();
                }
                String safe = URLEncoder.encode(username, StandardCharsets.UTF_8);
                // generate session token and map to channel id
                String sessionToken = java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 8);
                String channelId = event.getChannel().getId();
                sessionTokenToChannel.put(sessionToken, channelId);
                System.out.println("[DiscordBotService] Generated session token: " + sessionToken + " -> channelId: " + channelId);

                String link = this.playUrl + "?from=discord&user=" + safe + "&token=" + sessionToken;
                event.getChannel().sendMessage("Voici ton lien pour jouer: " + link).queue();
            } catch (Exception ex) {
                event.getChannel().sendMessage("Erreur lors de la génération du lien de jeu.").queue();
            }
        }
    }

    public void sendSimpleStatus(String message) {
        if (jda == null) {
            System.out.println("[DiscordBotService] Le bot Discord n'est pas initialisé.");
            return;
        }
        if (defaultChannelId == null || defaultChannelId.isBlank()) {
            System.out.println("[DiscordBotService] Aucun salon Discord configuré pour envoyer le message: " + message);
            return;
        }
        TextChannel channel = jda.getTextChannelById(defaultChannelId);
        if (channel != null) {
            channel.sendMessage(message).queue();
        } else {
            System.out.println("[DiscordBotService] Salon Discord introuvable pour l'ID: " + defaultChannelId);
        }
    }

    public String getChannelIdForToken(String token) {
        return sessionTokenToChannel.get(token);
    }

    public boolean sendMessageToChannelForToken(String token, String message) {
        String channelId = getChannelIdForToken(token);
        if (channelId == null) {
            System.out.println("[DiscordBotService] sendMessageToChannelForToken: token not found: " + token);
            return false;
        }
        TextChannel ch = jda.getTextChannelById(channelId);
        if (ch == null) {
            System.out.println("[DiscordBotService] sendMessageToChannelForToken: channel object null for id: " + channelId + " (token=" + token + ")");
            return false;
        }
        try {
            ch.sendMessage(message).queue(
                success -> System.out.println("[DiscordBotService] Message queued successfully to channelId=" + channelId + " (token=" + token + ")"),
                failure -> System.out.println("[DiscordBotService] Failed to send message to channelId=" + channelId + " (token=" + token + "): " + failure)
            );
            return true;
        } catch (Exception ex) {
            System.out.println("[DiscordBotService] Exception while sending message: " + ex.getMessage());
            ex.printStackTrace();
            return false;
        }
    }
}
