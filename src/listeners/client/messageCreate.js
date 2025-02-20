const { Listener } = require('@eartharoid/dbf');
const {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle: { Success },
	ChannelType,
	ComponentType,
	EmbedBuilder,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
} = require('discord.js');
const {
	getCommonGuilds,
	isStaff,
} = require('../../lib/users');
const ms = require('ms');
const emoji = require('node-emoji');
const { ChannelType, ThreadAutoArchiveDuration } = require('discord.js');

module.exports = class extends Listener {
	constructor(client, options) {
		super(client, {
			...options,
			emitter: client,
			event: 'messageCreate',
		});
	}

	async run(message) {
		/** @type {import("client")} */
		const client = this.client;

		if (!message.author.bot) {
			
			if (message.channel.id === '1082297348471922738') {
				try {
					await message.startThread({
						name: `art-${message.content.slice(0, 90)}`, 
						autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
						reason: 'Automatic art discussion thread'
					});
				} catch (error) {
					client.log.error('Failed to create art thread:', error);
				}
			}
			
			if (message.channel.id === '985620627585114163') {
				try {
					await message.startThread({
						name: `suggestion-${message.content.slice(0, 90)}`, 
						autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
						reason: 'Automatic suggestion discussion thread'
					});
				} catch (error) {
					client.log.error('Failed to create suggestion thread:', error);
				}
			}
		}

		if (message.channel.type === ChannelType.DM) {
			if (message.author.bot) return false;
			const commonGuilds = await getCommonGuilds(client, message.author.id);
			if (commonGuilds.size === 0) {
				return false;
			} else if (commonGuilds.size === 1) {
				const settings = await client.prisma.guild.findUnique({
					select: {
						categories: true,
						errorColour: true,
						locale: true,
						primaryColour: true,
					},
					where: { id: commonGuilds.at(0).id },
				});
				const getMessage = client.i18n.getLocale(settings.locale);
				const sent = await message.reply({
					components: [
						new ActionRowBuilder()
							.setComponents(
								new ButtonBuilder()
									.setCustomId(message.id)
									.setStyle(Success)
									.setLabel(getMessage('buttons.confirm_open.text'))
									.setEmoji(getMessage('buttons.confirm_open.emoji')),
							),
					],
					embeds: [
						new EmbedBuilder()
							.setColor(settings.primaryColour)
							.setTitle(getMessage('dm.confirm_open.title'))
							.setDescription(message.content),
					],
				});
				sent.awaitMessageComponent({
					componentType: ComponentType.Button,
					filter: () => true,
					time: ms('30s'),
				})
					.then(async interaction => await this.useGuild(settings, interaction, message.content))
					.catch(error => {
						if (error) client.log.error(error);
						sent.delete();
					});
			} else {
				const getMessage = client.i18n.getLocale();
				const sent = await message.reply({
					components: [
						new ActionRowBuilder()
							.setComponents(
								new StringSelectMenuBuilder()
									.setCustomId(message.id)
									.setPlaceholder(getMessage('menus.guild.placeholder'))
									.setOptions(
										commonGuilds.map(g =>
											new StringSelectMenuOptionBuilder()
												.setValue(String(g.id))
												.setLabel(g.name),
										),
									),
							),

					],
				});
				sent.awaitMessageComponent({
					componentType: ComponentType.SelectMenu,
					filter: () => true,
					time: ms('30s'),
				})
					.then(async interaction => {
						const settings = await client.prisma.guild.findUnique({
							select: {
								categories: true,
								errorColour: true,
								locale: true,
								primaryColour: true,
							},
							where: { id: interaction.values[0] },
						});
						await this.useGuild(settings, interaction, message.content);
					})
					.catch(error => {
						if (error) client.log.error(error);
						sent.delete();
					});
			}
		} else {
			const settings = await client.prisma.guild.findUnique({ where: { id: message.guild.id } });
			if (!settings) return;
			const getMessage = client.i18n.getLocale(settings.locale);
			let ticket = await client.prisma.ticket.findUnique({ where: { id: message.channel.id } });

			if (ticket) {
				// archive messages
				if (settings.archive) {
					client.tickets.archiver.saveMessage(ticket.id, message)
						.catch(error => {
							client.log.warn('Failed to archive message', message.id);
							client.log.error(error);
							message.react('❌').catch(client.log.error);
						});
				}

				if (!message.author.bot) {
					// update user's message count
					client.prisma.user.upsert({
						create: {
							id: message.author.id,
							messageCount: 1,
						},
						update: { messageCount: { increment: 1 } },
						where: { id: message.author.id },
					}).catch(client.log.error);

					// set first and last message timestamps
					const data = { lastMessageAt: new Date() };
					if (
						ticket.firstResponseAt === null &&
						await isStaff(message.guild, message.author.id)
					) data.firstResponseAt = new Date();
					ticket = await client.prisma.ticket.update({
						data,
						where: { id: ticket.id },
					});

					// if the ticket was set as stale, unset it
					if (client.tickets.$stale.has(ticket.id)) {
						const $ticket = client.tickets.$stale.get(ticket.id);
						$ticket.messages++;
						if ($ticket.messages >= 5) {
							await message.channel.messages.delete($ticket.message.id);
							client.tickets.$stale.delete(ticket.id);
						} else {
							client.tickets.$stale.set(ticket.id, $ticket);
						}
					}
				}

				if (!message.author.bot) {
					const key = `offline/${message.channel.id}`;
					let online = 0;
					for (const [, member] of message.channel.members) {
						if (!await isStaff(message.channel.guild, member.id)) continue;
						if (member.presence && member.presence !== 'offline') online++;
					}
					if (online === 0 && !client.keyv.has(key)) {
						await message.channel.send({
							embeds: [
								new EmbedBuilder()
									.setColor(settings.primaryColour)
									.setTitle(getMessage('ticket.offline.title'))
									.setDescription(getMessage('ticket.offline.description')),
							],
						});
						client.keyv.set(key, Date.now(), ms('1h'));
					}
				}
			}

			// auto-tag
			if (
				!message.author.bot &&
				(
					(settings.autoTag === 'all') ||
					(settings.autoTag === 'ticket' && ticket) ||
					(settings.autoTag === '!ticket' && !ticket) ||
					(settings.autoTag.includes(message.channel.id))
				)
			) {
				const cacheKey = `cache/guild-tags:${message.guild.id}`;
				let tags = await client.keyv.get(cacheKey);
				if (!tags) {
					tags = await client.prisma.tag.findMany({
						select: {
							content: true,
							id: true,
							name: true,
							regex: true,
						},
						where: { guildId: message.guild.id },
					});
					client.keyv.set(cacheKey, tags, ms('1h'));
				}

				const tag = tags.find(tag => tag.regex && message.content.match(new RegExp(tag.regex, 'mi')));
				if (tag) {
					await message.reply({
						embeds: [
							new EmbedBuilder()
								.setColor(settings.primaryColour)
								.setDescription(tag.content),
						],
					});
				}

			}
		}
	}
};
