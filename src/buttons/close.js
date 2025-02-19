const { Button } = require('@eartharoid/dbf');
const ExtendedEmbedBuilder = require('../lib/embed');
const { isStaff } = require('../lib/users');

module.exports = class CloseButton extends Button {
	constructor(client, options) {
		super(client, {
			...options,
			id: 'close',
		});
	}

	/**
	 * @param {*} id
	 * @param {import("discord.js").ButtonInteraction} interaction
	 */
	async run(id, interaction) {
		/** @type {import("client")} */
		const client = this.client;

		if (id.accepted === undefined) {
			// Initial close button click
			await client.tickets.beforeRequestClose(interaction);
		} else if (id.accepted) {
			// User confirmed closing
			await interaction.deferReply();
			await client.tickets.acceptClose(interaction);
		} else {
			// User cancelled closing
			await interaction.update({
				components: [],
				embeds: [
					new ExtendedEmbedBuilder()
						.setColor('Grey')
						.setDescription('Ticket closure cancelled.')
				]
			});
		}
	}
};
