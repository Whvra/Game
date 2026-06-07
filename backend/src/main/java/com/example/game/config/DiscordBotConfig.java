package com.example.game.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import com.example.game.service.DiscordBotService;

@Configuration
public class DiscordBotConfig {

    @Value("${discord.token:}")
    private String discordToken;

    @Value("${discord.default-channel-id:}")
    private String defaultChannelId;

    @Value("${game.play-url:http://localhost:4200}")
    private String playUrl;

    @Bean
    public DiscordBotService discordBotService() {
        return new DiscordBotService(discordToken, defaultChannelId, playUrl);
    }
}
