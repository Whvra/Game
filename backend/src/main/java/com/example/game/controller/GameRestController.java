package com.example.game.controller;

import com.example.game.model.ApiResponse;
import com.example.game.model.GameResult;
import com.example.game.service.DiscordBotService;
import com.example.game.service.GamePlayService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@CrossOrigin(origins = "*")
@RequestMapping("/api/game")
public class GameRestController {

    private final DiscordBotService discordBotService;
    private final GamePlayService gamePlayService;

    public GameRestController(DiscordBotService discordBotService, GamePlayService gamePlayService) {
        this.discordBotService = discordBotService;
        this.gamePlayService = gamePlayService;
    }

    @GetMapping("/health")
    public ResponseEntity<ApiResponse> health() {
        return ResponseEntity.ok(new ApiResponse("backend-ok", "Spring Boot backend is running"));
    }

    @GetMapping("/status")
    public ResponseEntity<GameResult> status() {
        return ResponseEntity.ok(gamePlayService.getStatus());
    }

    @PostMapping("/shoot")
    public ResponseEntity<GameResult> shoot(@RequestParam(defaultValue = "archery") String mode) {
        GameResult result = gamePlayService.shoot(mode);
        discordBotService.sendSimpleStatus("Tir de " + result.getMode() + " : " + result.getScore() + " points. " + result.getDetail());
        return ResponseEntity.ok(result);
    }

    @PostMapping("/notify-discord")
    public ResponseEntity<ApiResponse> notifyDiscord(@RequestParam("message") String message) {
        discordBotService.sendSimpleStatus(message);
        return ResponseEntity.ok(new ApiResponse("discord-notified", "Message forwarded to Discord bot"));
    }

    @PostMapping("/share-score")
    public ResponseEntity<ApiResponse> shareScore(@RequestParam("token") String token, @RequestParam("player") String player, @RequestParam("score") int score) {
        try {
            String msg = player + " a fait " + score + " points sur whyvgame";
            System.out.println("[GameRestController] shareScore called: token=" + token + ", player=" + player + ", score=" + score);
            boolean sent = discordBotService.sendMessageToChannelForToken(token, msg);
            if (sent) {
                System.out.println("[GameRestController] Message posted successfully");
                return ResponseEntity.ok(new ApiResponse("shared", "Score posted to Discord channel"));
            } else {
                System.out.println("[GameRestController] Token not found or channel inaccessible: " + token);
                return ResponseEntity.status(404).body(new ApiResponse("not-found", "Session token not found or channel inaccessible"));
            }
        } catch (Exception ex) {
            System.err.println("[GameRestController] Error in shareScore: " + ex.getMessage());
            ex.printStackTrace();
            return ResponseEntity.status(500).body(new ApiResponse("error", "Internal error: " + ex.getMessage()));
        }
    }
}
